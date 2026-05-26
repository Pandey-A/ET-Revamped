import re
with open('/etc/nginx/sites-available/chattiq', 'r') as f:
    config = f.read()
config = re.sub(r'\s*location /api/widget/ \{[^}]*\}\s*', '\n\n', config)
new_block = '''
    location /api/widget/ {
        proxy_pass http://127.0.0.1:8001/api/widget/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

'''
config = config.replace('location /api/ {', new_block + '    location /api/ {')
with open('/etc/nginx/sites-available/chattiq', 'w') as f:
    f.write(config)
