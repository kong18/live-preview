# Live Preview with License Management

A lightweight live preview app for webcam, screen share, and window share with built-in license key management via Vercel KV.

## Features

- 📷 **Webcam Preview** - Stream from webcam with multi-camera support
- 🖥️ **Screen Share** - Share entire screen or specific window
- 🔄 **Flip Controls** - Flip preview horizontally and vertically
- ⛶ **Fullscreen** - Auto-hide toolbar in fullscreen mode
- 🔑 **License Management** - Machine binding, expiration, revocation
- 💾 **Vercel KV Storage** - Redis-backed persistent license data
- ⏱️ **Offline Grace Period** - Works 24 hours offline after last validation
- 👨‍💼 **Admin Dashboard** - Create keys, revoke licenses, view usage

## Tech Stack

- **Frontend**: Vanilla JavaScript (zero dependencies)
- **Backend**: Vercel Serverless Functions
- **Storage**: Vercel KV (Redis)
- **Config**: Vercel Edge Config
- **Deployment**: Vercel

## Project Structure

```
project/
├── public/
│   ├── index.html          # Main app (media preview + license UI)
│   └── admin.html          # Admin dashboard (TODO)
├── api/
│   ├── activate.js         # License activation endpoint
│   ├── validate.js         # License validation endpoint
│   ├── deactivate.js       # License deactivation endpoint
│   ├── admin/
│   │   ├── auth.js         # Admin login
│   │   ├── keys.js         # Create/list licenses
│   │   └── keys/[hash].js  # Update/revoke license
│   └── _lib/
│       ├── kv.js           # Vercel KV client
│       ├── edge-config.js  # Edge Config helper
│       ├── license-utils.js# License utilities
│       ├── rate-limit.js   # Rate limiting
│       └── admin-auth.js   # JWT verification
├── vercel.json             # Vercel configuration
├── package.json            # Dependencies
└── README.md               # This file
```

## Quick Start

### Prerequisites

- Node.js 18+
- Vercel CLI (`npm i -g vercel`)
- Vercel account

### Local Development

1. **Clone and setup**
   ```bash
   git clone <repo>
   cd live-preview
   npm install
   ```

2. **Link to Vercel project**
   ```bash
   vercel link
   ```

3. **Setup Vercel KV & Edge Config**
   ```bash
   vercel kv create live-preview-license
   vercel edge-config create live-preview-config
   ```

4. **Pull environment variables**
   ```bash
   vercel env pull .env.local
   ```

5. **Add security secrets**
   ```bash
   vercel env add LICENSE_SECRET
   vercel env add ADMIN_JWT_SECRET
   ```

6. **Start dev server**
   ```bash
   npm run dev
   # Runs on http://localhost:3000
   ```

### Production Deployment

1. **Set environment variables in Vercel Dashboard**
   - Go to Project Settings → Environment Variables
   - Add: `LICENSE_SECRET`, `ADMIN_JWT_SECRET`
   - Apply to: Production, Preview
  - Ensure `EDGE_CONFIG` is present in the project environment so `@vercel/edge-config` can read `admin_credentials`

2. **Create first admin user**
   ```bash
   # In Vercel KV UI or via script:
   # 1. Generate bcrypt hash of password:
   node -e "console.log(require('bcryptjs').hashSync('YourStrongPassword123!', 10))"
   
   # 2. Upload to Edge Config:
   vercel edge-config push --yes admin-init.json
   ```

   Example `admin-init.json`:
   ```json
   {
     "admin_credentials": {
       "admin@yourdomain.com": "$2b$10$XxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXx"
     }
   }
   ```

3. **Deploy**
   ```bash
   npm run deploy
   # Or: git push (if linked to GitHub)
   ```

## API Reference

### License Activation
`POST /api/activate`

Activate a license key on a machine (first-time binding).

**Request**
```json
{
  "key": "LIVE-ABCD-1234-5678",
  "fingerprint": "abc123def456...",
  "userAgent": "Mozilla/5.0..."
}
```

**Response (Success)**
```json
{
  "success": true,
  "plan": "30d",
  "expires_at": "1735689600000",
  "activated_at": "1704153600000",
  "features": ["webcam", "screen-share", "flip", "fullscreen"]
}
```

### License Validation
`POST /api/validate`

Periodic heartbeat check to validate license is still valid.

**Request**
```json
{
  "key": "LIVE-ABCD-1234-5678",
  "fingerprint": "abc123def456..."
}
```

**Response (Valid)**
```json
{
  "valid": true,
  "expires_at": "1735689600000",
  "remaining_ms": 123456789
}
```

### Admin Login
`POST /api/admin/auth`

**Request**
```json
{
  "email": "admin@yourdomain.com",
  "password": "YourStrongPassword123!"
}
```

**Response**
```json
{
  "token": "eyJhbGc...",
  "expiresIn": "24h",
  "email": "admin@yourdomain.com"
}
```

### Create License Keys
`POST /api/admin/keys` (requires Authorization header)

**Request**
```json
{
  "quantity": 10,
  "plan": "30d"
}
```

**Response**
```json
{
  "success": true,
  "quantity": 10,
  "plan": "30d",
  "expires_at": 1735689600000,
  "keys": [
    "LIVE-XXXX-XXXX-XXXX",
    "LIVE-YYYY-YYYY-YYYY",
    ...
  ],
  "message": "Save these keys! They will not be shown again."
}
```

### List Licenses
`GET /api/admin/keys?page=1&pageSize=20` (requires Authorization header)

### Revoke License
`PATCH /api/admin/keys/[hash]` (requires Authorization header)

**Request**
```json
{
  "revoked": true
}
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `H` | Flip Horizontal |
| `V` | Flip Vertical |
| `F` | Toggle Fullscreen |
| `Esc` | Return to source selection |

## Security Notes

- ✅ License keys are hashed (SHA-256) before storage
- ✅ Machine fingerprints are hashed and truncated for audit logs
- ✅ IP addresses are hashed to protect privacy
- ✅ Admin passwords use bcrypt (never stored plaintext)
- ✅ JWT tokens for admin sessions expire in 24 hours
- ✅ Rate limiting on activation endpoint (5 attempts per 60s per IP)
- ✅ Offline grace period: 24 hours after last successful validation
- ⚠️ Never commit `.env` files or export Vercel secrets

## Monitoring

- **Vercel Dashboard**: Monitor KV usage, function invocations, errors
- **Audit Logs**: Check `audit:{license_hash}` in KV for per-license activity
- **Admin Logs**: Check `audit:admin` in KV for administrative actions

## Troubleshooting

### "License not found" error
- Verify license key is correct (format: `LIVE-XXXX-XXXX-XXXX`)
- Check key hasn't been revoked in admin dashboard
- Ensure key hasn't expired

### "License bound to other machine"
- Machine fingerprint doesn't match
- Use `/api/deactivate` to unbind first, then activate on new machine

### "Rate limited" error
- Too many activation attempts from same IP
- Wait 60 seconds before retrying

### Offline not working after 24 hours
- Last validation timestamp is older than 24 hours
- Reconnect to internet and validate license

## Future Enhancements

- [ ] Admin dashboard UI (`public/admin.html`)
- [ ] CSV export functionality
- [ ] Real-time revocation notifications (Vercel Pub/Sub)
- [ ] Usage analytics and reporting
- [ ] License transfer between machines
- [ ] Bulk key generation and management
- [ ] Email notifications for license expiration

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review Vercel KV logs in dashboard
3. Enable debug logging in browser console

## License

[Your License Here]
