#!/bin/bash
# setup-modsec.sh — Install ModSecurity 3 + OWASP CRS + nginx integration
# Run as root on the server: sudo bash scripts/setup-modsec.sh

set -e
NGINX_CONF_DIR="/etc/nginx"
MODSEC_DIR="/etc/nginx/modsec"
AUDIT_LOG="/var/log/nginx/modsec_audit.log"
CRS_DIR="$MODSEC_DIR/crs"

echo "==> Detecting nginx..."
NGINX_V=$(nginx -v 2>&1 | grep -o '[0-9.]*' | head -1)
echo "    nginx $NGINX_V"

echo "==> Installing ModSecurity..."
apt-get update -qq
apt-get install -y libmodsecurity3 libnginx-mod-security2

echo "==> Setting up ModSecurity config directory..."
mkdir -p "$MODSEC_DIR"

# Copy and configure main modsecurity.conf
if [ -f /etc/modsecurity/modsecurity.conf-recommended ]; then
  cp /etc/modsecurity/modsecurity.conf-recommended "$MODSEC_DIR/modsecurity.conf"
elif [ -f /usr/share/modsecurity-crs/modsecurity.conf-recommended ]; then
  cp /usr/share/modsecurity-crs/modsecurity.conf-recommended "$MODSEC_DIR/modsecurity.conf"
else
  # Download it
  curl -sL https://raw.githubusercontent.com/owasp-modsecurity/ModSecurity/v3/master/modsecurity.conf-recommended \
    -o "$MODSEC_DIR/modsecurity.conf"
fi

# Tune the main config
sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine DetectionOnly/' "$MODSEC_DIR/modsecurity.conf"
sed -i 's/SecRequestBodyLimit 13107200/SecRequestBodyLimit 52428800/' "$MODSEC_DIR/modsecurity.conf"
sed -i 's/SecAuditLogParts ABIJDEFHZ/SecAuditLogParts ABCFHIJZ/' "$MODSEC_DIR/modsecurity.conf"

# Add JSON audit log config
cat >> "$MODSEC_DIR/modsecurity.conf" << 'EOF'

# JSON audit log for admin panel
SecAuditLog /var/log/nginx/modsec_audit.log
SecAuditLogType Serial
SecAuditLogFormat JSON
SecAuditLogRelevantStatus "^(?:5|4(?!04))"
EOF

echo "==> Installing OWASP Core Rule Set..."
if apt-cache show modsecurity-crs &>/dev/null; then
  apt-get install -y modsecurity-crs
  CRS_RULES_DIR=$(dpkg -L modsecurity-crs | grep 'rules$' | head -1)
  [ -z "$CRS_RULES_DIR" ] && CRS_RULES_DIR="/usr/share/modsecurity-crs/rules"
  ln -sfn "$CRS_RULES_DIR" "$MODSEC_DIR/rules"
  CRS_SETUP=$(dpkg -L modsecurity-crs | grep 'crs-setup.conf' | head -1)
  [ -f "$CRS_SETUP" ] && cp "$CRS_SETUP" "$MODSEC_DIR/crs-setup.conf"
else
  echo "    Downloading CRS from GitHub..."
  mkdir -p "$CRS_DIR"
  LATEST=$(curl -s https://api.github.com/repos/coreruleset/coreruleset/releases/latest | grep tag_name | cut -d'"' -f4)
  curl -sL "https://github.com/coreruleset/coreruleset/archive/${LATEST}.tar.gz" | \
    tar -xz -C /tmp
  CRS_TMP=$(ls -d /tmp/coreruleset-* | head -1)
  cp -r "$CRS_TMP/rules" "$MODSEC_DIR/rules"
  cp "$CRS_TMP/crs-setup.conf.example" "$MODSEC_DIR/crs-setup.conf"
  rm -rf "$CRS_TMP"
fi

echo "==> Writing main.conf..."
cat > "$MODSEC_DIR/main.conf" << 'EOF'
Include /etc/nginx/modsec/modsecurity.conf
Include /etc/nginx/modsec/crs-setup.conf
Include /etc/nginx/modsec/rules/*.conf
Include /etc/nginx/modsec/custom-rules.conf
EOF

echo "==> Creating custom rules file..."
cat > "$MODSEC_DIR/custom-rules.conf" << 'EOF'
# Custom exclusions managed by admin panel
# Do not edit manually
EOF

echo "==> Setting up audit log..."
touch "$AUDIT_LOG"
chmod 640 "$AUDIT_LOG"
chown root:www-data "$AUDIT_LOG"
# Logrotate config
cat > /etc/logrotate.d/modsec << 'EOF'
/var/log/nginx/modsec_audit.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 640 root www-data
    postrotate
        nginx -s reopen
    endscript
}
EOF

echo "==> Setting permissions for admin panel..."
chown -R root:www-data "$MODSEC_DIR"
chmod -R 750 "$MODSEC_DIR"
# Allow www-data to write only the files the admin needs
chown www-data "$MODSEC_DIR/custom-rules.conf"
chmod 640 "$MODSEC_DIR/custom-rules.conf"
# Mode conf (just SecRuleEngine line, admin toggles this)
echo 'SecRuleEngine DetectionOnly' > "$MODSEC_DIR/mode.conf"
chown www-data "$MODSEC_DIR/mode.conf"
chmod 640 "$MODSEC_DIR/mode.conf"
# Add mode.conf to main.conf
echo 'Include /etc/nginx/modsec/mode.conf' >> "$MODSEC_DIR/main.conf"
# Remove SecRuleEngine from main modsecurity.conf so mode.conf controls it
sed -i 's/^SecRuleEngine.*$/# SecRuleEngine controlled by mode.conf/' "$MODSEC_DIR/modsecurity.conf"

echo "==> Updating sudoers..."
cat > /etc/sudoers.d/andresanz-admin << 'EOF'
www-data ALL=(ALL) NOPASSWD: /bin/systemctl restart andresanz, /bin/systemctl restart blog-*, /bin/systemctl stop blog-*, /bin/systemctl start blog-*, /bin/systemctl enable blog-*, /bin/systemctl disable blog-*, /bin/systemctl reload nginx, /usr/bin/fail2ban-client *, /usr/bin/tail *
EOF
chmod 440 /etc/sudoers.d/andresanz-admin

echo "==> Patching nginx site configs to enable ModSecurity..."
for conf in /etc/nginx/sites-enabled/*; do
  if grep -q 'modsecurity' "$conf" 2>/dev/null; then
    echo "    $conf already has modsecurity — skipping"
    continue
  fi
  # Insert into each server block
  sed -i '/server {/a\    modsecurity on;\n    modsecurity_rules_file /etc/nginx/modsec/main.conf;' "$conf"
  echo "    Patched: $conf"
done

echo "==> Testing nginx config..."
nginx -t

echo "==> Reloading nginx..."
systemctl reload nginx

echo ""
echo "✓ ModSecurity installed in DetectionOnly mode"
echo "  Audit log:    $AUDIT_LOG"
echo "  Config:       $MODSEC_DIR/"
echo "  Admin panel:  admin.andresanz.com/waf"
echo ""
echo "  Switch to blocking: admin panel → WAF → Mode → Blocking"
