# EL Team Portal

Easy Lemon Staff Case Management Portal

## Features

- Microsoft Azure AD authentication
- Real-time case dashboard
- Staff user management
- Secure access control

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.local.example .env.local
# Edit .env.local with your actual values
```

3. Run the development server:
```bash
npm run dev
```

## Deployment

This app is designed to be deployed on Vercel with:
- Custom domain: team.easylemon.com
- Microsoft Azure AD authentication
- Supabase database integration

## Environment Variables

- `NEXTAUTH_URL` - Your production domain
- `NEXTAUTH_SECRET` - Random secret for auth
- `AZURE_AD_CLIENT_ID` - Microsoft app client ID
- `AZURE_AD_CLIENT_SECRET` - Microsoft app secret
- `AZURE_AD_TENANT_ID` - Microsoft tenant ID
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key