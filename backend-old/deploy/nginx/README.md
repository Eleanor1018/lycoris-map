# Nginx Reverse Proxy (Hetzner / EC2)

This folder contains a ready-to-use Nginx site config for:

- `api.lycoris.online` -> Spring Boot backend (`127.0.0.1:8080`)

## 1) Copy config

```bash
sudo cp deploy/nginx/api.lycoris.online.conf /etc/nginx/sites-available/api.lycoris.online.conf
sudo ln -s /etc/nginx/sites-available/api.lycoris.online.conf /etc/nginx/sites-enabled/api.lycoris.online.conf
```

If default site exists:

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

## 2) DNS

Point the DNS record:

- `api.lycoris.online` -> your server public IPv4

## 3) Obtain TLS cert (Let's Encrypt)

Install certbot plugin:

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

Issue cert:

```bash
sudo certbot --nginx -d api.lycoris.online
```

## 4) Validate and reload

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 5) Backend prerequisite

Backend should be running on:

- `127.0.0.1:8080`

For Docker compose setup, expose backend port on host (`8080:8080`) as in `docker-compose.ec2.yml`.

## 6) Important (cross-domain frontend)

If frontend is served from `https://lycoris.online` and backend from `https://api.lycoris.online`,
you also need backend CORS + session cookie settings for cross-site requests.
