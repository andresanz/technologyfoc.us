#!/bin/bash
# setup-modsec.sh — Install ModSecurity 3 + OWASP CRS + nginx integration
# Run as root on the server: sudo bash scripts/setup-modsec.sh

set -e
MODSEC_DIR="/etc/nginx/modsec"
AUDIT_LOG="/var/log/nginx/modsec_audit.log"
BUILD_DIR="/tmp/modsec-build"

echo "==> Detecting nginx..."
NGINX_V=$(nginx -v 2>&1 | grep -o '[0-9.]*' | head -1)
echo "    nginx $NGINX_V"

echo "==> Installing build dependencies + ModSecurity library..."
apt-get update -qq
apt-get install -y \
  git build-essential libpcre3-dev zlib1g-dev libssl-dev \
  libmodsecurity3t64 libmodsecurity-dev \
  libyajl-dev libgeoip-dev libcurl4-openssl-dev \
  nginx-dev wget

echo "==> Building ModSecurity nginx connector from source..."
rm -rf "$BUILD_DIR" && mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Get ModSecurity nginx connector
git clone --depth 1 https://github.com/SpiderLabs/ModSecurity-nginx modsecurity-nginx

# Get matching nginx source
wget -q "http://nginx.org/download/nginx-${NGINX_V}.tar.gz"
tar -xzf "nginx-${NGINX_V}.tar.gz"

# Build dynamic module only
cd "nginx-${NGINX_V}"
NGINX_CC_OPT=$(nginx -V 2>&1 | grep "configure arguments" | grep -o '\-\-with-cc-opt=[^ ]*' || true)
./configure --with-compat --add-dynamic-module="$BUILD_DIR/modsecurity-nginx" 2>/dev/null
make modules 2>/dev/null

# Install module
MODULES_DIR=$(nginx -V 2>&1 | grep -o 'modules-path=[^ ]*' | cut -d= -f2 || echo '/usr/lib/nginx/modules')
mkdir -p "$MODULES_DIR"
cp objs/ngx_http_modsecurity_module.so "$MODULES_DIR/"
echo "    Module installed → $MODULES_DIR/ngx_http_modsecurity_module.so"

# Load module in nginx
LOAD_LINE='load_module modules/ngx_http_modsecurity_module.so;'
if [ -d /etc/nginx/modules-enabled ]; then
  echo "$LOAD_LINE" > /etc/nginx/modules-enabled/50-modsecurity.conf
elif ! grep -q 'ngx_http_modsecurity' /etc/nginx/nginx.conf; then
  sed -i "1i $LOAD_LINE" /etc/nginx/nginx.conf
fi

echo "==> Setting up ModSecurity config..."
mkdir -p "$MODSEC_DIR"

# Get modsecurity.conf
if [ -f /etc/modsecurity/modsecurity.conf-recommended ]; then
  cp /etc/modsecurity/modsecurity.conf-recommended "$MODSEC_DIR/modsecurity.conf"
elif [ -f /usr/share/modsecurity-crs/modsecurity.conf-recommended ]; then
  cp /usr/share/modsecurity-crs/modsecurity.conf-recommended "$MODSEC_DIR/modsecurity.conf"
else
  curl -sL https://raw.githubusercontent.com/owasp-modsecurity/ModSecurity/v3/master/modsecurity.conf-recommended \
    -o "$MODSEC_DIR/modsecurity.conf"
fi

# Get unicode map
if [ ! -f "$MODSEC_DIR/unicode.mapping" ]; then
  curl -sL https://raw.githubusercontent.com/owasp-modsecurity/ModSecurity/v3/master/unicode.mapping \
    -o "$MODSEC_DIR/unicode.mapping"
fi

# Tune modsecurity.conf (SecRuleEngine will be in mode.conf)
sed -i 's/^SecRuleEngine.*$/# SecRuleEngine controlled by mode.conf/' "$MODSEC_DIR/modsecurity.conf"
sed -i 's/SecAuditLogParts ABIJDEFHZ/SecAuditLogParts ABCFHIJZ/' "$MODSEC_DIR/modsecurity.conf"
sed -i 's/SecRequestBodyLimit 13107200/SecRequestBodyLimit 52428800/' "$MODSEC_DIR/modsecurity.conf"

# Append audit log config
grep -q 'SecAuditLogFormat' "$MODSEC_DIR/modsecurity.conf" || cat >> "$MODSEC_DIR/modsecurity.conf" << 'EOF'

# Audit log
SecAuditLog /var/log/nginx/modsec_audit.log
SecAuditLogType Serial
SecAuditLogFormat JSON
SecAuditLogRelevantStatus "^(?:5|4(?!04))"
EOF

echo "==> Installing OWASP Core Rule Set..."
if apt-cache show modsecurity-crs &>/dev/null && apt-get install -y modsecurity-crs 2>/dev/null; then
  CRS_RULES=$(dpkg -L modsecurity-crs 2>/dev/null | grep 'rules$' | head -1 || echo "")
  [ -z "$CRS_RULES" ] && CRS_RULES="/usr/share/modsecurity-crs/rules"
  ln -sfn "$CRS_RULES" "$MODSEC_DIR/rules"
  CRS_SETUP=$(dpkg -L modsecurity-crs 2>/dev/null | grep 'crs-setup.conf' | head -1 || echo "")
  [ -f "$CRS_SETUP" ] && cp "$CRS_SETUP" "$MODSEC_DIR/crs-setup.conf"
else
  echo "    Downloading CRS from GitHub..."
  LATEST=$(curl -s https://api.github.com/repos/coreruleset/coreruleset/releases/latest | grep tag_name | cut -d'"' -f4)
  curl -sL "https://github.com/coreruleset/coreruleset/archive/${LATEST}.tar.gz" | tar -xz -C /tmp
  CRS_TMP=$(ls -d /tmp/coreruleset-* | head -1)
  mkdir -p "$MODSEC_DIR/rules"
  cp "$CRS_TMP/rules/"*.conf "$MODSEC_DIR/rules/"
  cp "$CRS_TMP/crs-setup.conf.example" "$MODSEC_DIR/crs-setup.conf"
  rm -rf "$CRS_TMP"
fi

# Ensure crs-setup.conf exists
[ ! -f "$MODSEC_DIR/crs-setup.conf" ] && touch "$MODSEC_DIR/crs-setup.conf"

echo "==> Writing config files..."
# mode.conf — admin panel toggles this
echo 'SecRuleEngine DetectionOnly' > "$MODSEC_DIR/mode.conf"

# custom-rules.conf — admin panel writes this
cat > "$MODSEC_DIR/custom-rules.conf" << 'EOF'
# Custom exclusions managed by admin panel — do not edit manually
EOF

# main.conf — includes everything
cat > "$MODSEC_DIR/main.conf" << 'EOF'
Include /etc/nginx/modsec/modsecurity.conf
Include /etc/nginx/modsec/crs-setup.conf
Include /etc/nginx/modsec/rules/*.conf
Include /etc/nginx/modsec/custom-rules.conf
Include /etc/nginx/modsec/mode.conf
EOF

echo "==> Setting permissions..."
touch "$AUDIT_LOG"
chmod 640 "$AUDIT_LOG"
chown root:www-data "$AUDIT_LOG"
chown -R root:www-data "$MODSEC_DIR"
chmod -R 750 "$MODSEC_DIR"
chown www-data "$MODSEC_DIR/mode.conf" "$MODSEC_DIR/custom-rules.conf"
chmod 640 "$MODSEC_DIR/mode.conf" "$MODSEC_DIR/custom-rules.conf"

# Logrotate
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

echo "==> Enabling ModSecurity in nginx site configs..."
MODSEC_LINES="    modsecurity on;\n    modsecurity_rules_file /etc/nginx/modsec/main.conf;"
for conf in /etc/nginx/sites-enabled/*; do
  # Remove any existing modsecurity directives first (idempotent)
  sed -i '/^\s*modsecurity[^_]/d' "$conf"
  sed -i '/^\s*modsecurity_rules_file/d' "$conf"
  # Insert once after the first server { line
  sed -i "0,/server\s*{/s|server\s*{|server {\n${MODSEC_LINES}|" "$conf"
  echo "    Patched: $conf"
done

echo "==> Testing nginx config..."
nginx -t

echo "==> Reloading nginx..."
systemctl reload nginx

# Cleanup
rm -rf "$BUILD_DIR"

echo ""
echo "✓ ModSecurity installed in DetectionOnly mode"
echo "  nginx module: $MODULES_DIR/ngx_http_modsecurity_module.so"
echo "  audit log:    $AUDIT_LOG"
echo "  config:       $MODSEC_DIR/"
echo "  admin panel:  admin.andresanz.com/waf"
echo ""
echo "  Monitor events, then switch to Blocking in the admin panel."
