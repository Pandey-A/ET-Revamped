import re
with open('/etc/nginx/sites-available/chattiq', 'r') as f:
    config = f.read()

# Replace the existing location /api/widget/ block
new_block = '''
    location /api/widget/ {
        # Transparently add a trailing slash if missing, so Next.js doesn't issue a 308 redirect
        rewrite ^(/api/widget/.*[^/])$ $1/ break;
        
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
'''

config = re.sub(r'\s*location /api/widget/ \{[^}]*\}\s*', '\n' + new_block + '\n', config)

with open('/etc/nginx/sites-available/chattiq', 'w') as f:
    f.write(config)
