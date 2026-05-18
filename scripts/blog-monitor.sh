#!/usr/bin/env bash
# blog-monitor.sh — health checks + alerting
# Writes JSON to /var/log/blog-health.json, emails on critical changes

HEALTH_FILE=/var/log/blog-health.json
ALERT_COOLDOWN_FILE=/var/run/blog-monitor-alerted
STATUS_LOG=/var/log/blog-monitor.log
ALERT_EMAIL=sanz.andre@gmail.com
HOSTNAME_LABEL=server02.andresanz.com

# Thresholds
DISK_WARN=80
DISK_CRIT=90
MEM_WARN=85
MEM_CRIT=95
SSL_WARN=21   # days
SSL_CRIT=7    # days

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ALERTS=()

# ── Helpers ────────────────────────────────────────────────────────────────────
log() { echo "$(date '+%F %T') $*" >> "$STATUS_LOG"; }

check_service() {
  local name=$1
  systemctl is-active --quiet "$name" && echo "active" || echo "failed"
}

ssl_days_left() {
  local domain=$1
  local expiry
  expiry=$(echo | timeout 8 openssl s_client -connect "${domain}:443" \
    -servername "$domain" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | sed 's/notAfter=//' || true)
  [ -z "$expiry" ] && { echo "-1"; return; }
  local exp_epoch now_epoch
  exp_epoch=$(date -d "$expiry" +%s 2>/dev/null || echo 0)
  now_epoch=$(date +%s)
  echo $(( (exp_epoch - now_epoch) / 86400 ))
}

json_str() {
  # Minimal JSON string escaping
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# ── Service checks ─────────────────────────────────────────────────────────────
SERVICES_JSON=""
INFRA_SVCS="nginx redis-server fail2ban postfix ssh cron"
ALL_BLOG_SVCS=$(systemctl list-units 'blog-*.service' --no-pager --no-legend 2>/dev/null \
  | awk '{print $1}' | sed 's/.service$//' | tr '\n' ' ' || true)

for svc in $INFRA_SVCS $ALL_BLOG_SVCS; do
  [ -z "$svc" ] && continue
  status=$(check_service "$svc")
  [ -n "$SERVICES_JSON" ] && SERVICES_JSON+=","
  SERVICES_JSON+="{\"name\":\"$svc\",\"status\":\"$status\"}"
  if [ "$status" != "active" ]; then
    ALERTS+=("CRITICAL: service $svc is $status")
  fi
done

# ── Disk check ─────────────────────────────────────────────────────────────────
disk_info=$(df -k / | tail -1)
disk_size=$(echo "$disk_info" | awk '{print $2}')
disk_used=$(echo "$disk_info" | awk '{print $3}')
disk_pct=$(( disk_used * 100 / disk_size ))
if   [ "$disk_pct" -ge "$DISK_CRIT" ]; then
  disk_level="critical"; ALERTS+=("CRITICAL: disk usage ${disk_pct}%")
elif [ "$disk_pct" -ge "$DISK_WARN" ]; then
  disk_level="warning";  ALERTS+=("WARNING: disk usage ${disk_pct}%")
else
  disk_level="ok"
fi

# ── Memory check ──────────────────────────────────────────────────────────────
mem_total=$(awk '/MemTotal/{print $2}' /proc/meminfo)
mem_avail=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
mem_used=$(( mem_total - mem_avail ))
mem_pct=$(( mem_used * 100 / mem_total ))
if   [ "$mem_pct" -ge "$MEM_CRIT" ]; then
  mem_level="critical"; ALERTS+=("CRITICAL: memory usage ${mem_pct}%")
elif [ "$mem_pct" -ge "$MEM_WARN" ]; then
  mem_level="warning";  ALERTS+=("WARNING: memory usage ${mem_pct}%")
else
  mem_level="ok"
fi

# ── SSL cert checks ────────────────────────────────────────────────────────────
DOMAINS="914.io andresanz.com andresanz.me randomcategory.com therandomactofwriting.com admin.server02.andresanz.com"
SSL_JSON=""
for domain in $DOMAINS; do
  days=$(ssl_days_left "$domain")
  if   [ "$days" -lt 0 ]; then
    level="error"; ALERTS+=("CRITICAL: SSL cert check failed for $domain")
  elif [ "$days" -lt "$SSL_CRIT" ]; then
    level="critical"; ALERTS+=("CRITICAL: SSL cert for $domain expires in ${days}d")
  elif [ "$days" -lt "$SSL_WARN" ]; then
    level="warning"; ALERTS+=("WARNING: SSL cert for $domain expires in ${days}d")
  else
    level="ok"
  fi
  [ -n "$SSL_JSON" ] && SSL_JSON+=","
  SSL_JSON+="{\"domain\":\"$domain\",\"days\":$days,\"level\":\"$level\"}"
done

# ── Write health JSON ──────────────────────────────────────────────────────────
ALERT_COUNT=${#ALERTS[@]}
OVERALL="ok"
if [ "$ALERT_COUNT" -gt 0 ]; then
  OVERALL="warning"
  for a in "${ALERTS[@]}"; do
    if [[ "$a" == CRITICAL* ]]; then OVERALL="critical"; break; fi
  done
fi

# Build alerts JSON array
ALERTS_JSON=""
if [ "$ALERT_COUNT" -gt 0 ]; then
  for a in "${ALERTS[@]}"; do
    [ -z "$a" ] && continue
    [ -n "$ALERTS_JSON" ] && ALERTS_JSON+=","
    safe=$(json_str "$a")
    ALERTS_JSON+="\"$safe\""
  done
fi

cat > "${HEALTH_FILE}.tmp" << ENDJSON
{
  "timestamp": "$TIMESTAMP",
  "overall": "$OVERALL",
  "services": [$SERVICES_JSON],
  "disk": {"pct":$disk_pct,"usedKB":$disk_used,"totalKB":$disk_size,"level":"$disk_level"},
  "memory": {"pct":$mem_pct,"usedKB":$mem_used,"totalKB":$mem_total,"level":"$mem_level"},
  "ssl": [$SSL_JSON],
  "alerts": [$ALERTS_JSON]
}
ENDJSON
mv "${HEALTH_FILE}.tmp" "$HEALTH_FILE"
chown root:root "$HEALTH_FILE"
chmod 644 "$HEALTH_FILE"

# ── Email alerting with cooldown ───────────────────────────────────────────────
if [ "$ALERT_COUNT" -gt 0 ]; then
  SHOULD_ALERT=1
  if [ -f "$ALERT_COOLDOWN_FILE" ]; then
    last=$(cat "$ALERT_COOLDOWN_FILE")
    now=$(date +%s)
    # Cooldown: 4 hours = 14400 seconds
    if [ $(( now - last )) -lt 14400 ]; then
      SHOULD_ALERT=0
    fi
  fi

  if [ "$SHOULD_ALERT" -eq 1 ]; then
    BODY="Health alerts from $HOSTNAME_LABEL at $TIMESTAMP:"$'\n\n'
    for a in "${ALERTS[@]}"; do BODY+="  • $a"$'\n'; done
    BODY+=$'\n'"View details: https://admin.server02.andresanz.com/server/health"
    echo "$BODY" | mail -s "[$OVERALL] $HOSTNAME_LABEL health alert" "$ALERT_EMAIL"
    date +%s > "$ALERT_COOLDOWN_FILE"
    log "Sent alert email: $ALERT_COUNT issues ($OVERALL)"
  fi
else
  # All clear — reset cooldown so next incident fires immediately
  rm -f "$ALERT_COOLDOWN_FILE"
fi

log "Check done: $OVERALL (${ALERT_COUNT} alerts)"
