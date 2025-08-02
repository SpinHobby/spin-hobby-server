# Environment Variables Setup

## ✅ Migration Scripts Fixed!

Great news! The ES module issue is now resolved. Your migration scripts are working properly.

## 🔧 Next Step: NeonDB Setup

Perfect choice! NeonDB is a serverless PostgreSQL service - no local setup required!

### 1. Get Your NeonDB Credentials

📚 **For detailed step-by-step instructions, see [`NEONDB_SETUP.md`](./NEONDB_SETUP.md)**

Quick version:

1. Go to [NeonDB Console](https://console.neon.tech/)
2. Sign up or log in
3. Create a new project called "spin-hobby"
4. Copy your database credentials

### 2. Create `.env` file

Create a file called `.env` in your `spin-hobby-server` directory with your NeonDB credentials:

```bash
# NeonDB Configuration
DB_HOST=your-project-name.neon.tech
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_username
DB_PASSWORD=your_password

# Express Server Configuration
EXPRESS_PORT=8001
NODE_ENV=development

# JWT Configuration (IMPORTANT: Generate securely!)
JWT_SECRET=your_secure_jwt_secret_here
```

### Alternative: Use Connection String

If you prefer, you can also use the full connection string format:

```bash
# NeonDB Connection String (alternative method)
DATABASE_URL=postgresql://username:password@hostname/database?sslmode=require

# Express Server Configuration
EXPRESS_PORT=8001
NODE_ENV=development
JWT_SECRET=your_secure_jwt_secret_here
```

### 3. Generate Secure JWT Secret

Run this command to generate a secure JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output and use it as your `JWT_SECRET`.

### 4. Test Your Setup

After creating your `.env` file:

```bash
# Test database connection
npm run db:test

# If successful, run migrations
npm run migrate:reset
```

### 4. Example .env File with NeonDB

Here's a complete example `.env` file using NeonDB:

```bash
# NeonDB Configuration
DB_HOST=ep-cool-cloud-123456.us-east-1.aws.neon.tech
DB_PORT=5432
DB_NAME=neondb
DB_USER=your_username
DB_PASSWORD=your_password

# Express Server Configuration
EXPRESS_PORT=8001
NODE_ENV=development

# JWT Configuration (generate this securely!)
JWT_SECRET=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456789012345678901234567890abcdef123456

# Square API Configuration (add these later)
SQUARE_APPLICATION_ID=your_square_application_id
SQUARE_APPLICATION_SECRET=your_square_application_secret
SQUARE_ACCESS_TOKEN=your_square_access_token
SQUARE_ENVIRONMENT=sandbox
```

## 🌟 Why NeonDB is Perfect for Your Project

- ✅ **No local setup** - runs in the cloud
- ✅ **PostgreSQL compatible** - works with all our migrations
- ✅ **Free tier available** - perfect for development
- ✅ **Automatic backups** - your data is safe
- ✅ **Fast & reliable** - serverless PostgreSQL
- ✅ **Perfect for Square integration** - scales with your anime store

## ✅ Verification

Once you have your `.env` file set up:

1. **Test connection:** `npm run db:test`
2. **Run migrations:** `npm run migrate:reset`
3. **Check status:** `npm run migrate:status`
4. **Start server:** `npm run dev`

## 🛠️ Troubleshooting

- **"Connection refused"**: PostgreSQL isn't running
- **"User undefined"**: Missing `DB_USER` in `.env`
- **"Password must be string"**: Missing `DB_PASSWORD` in `.env`
- **"Database does not exist"**: Run `createdb spin_hobby` or use Docker

Your migration system is ready to go! 🎉
