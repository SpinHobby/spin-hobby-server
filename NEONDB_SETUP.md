# 🌟 NeonDB Setup Guide for Spin Hobby

Get your anime merchandise store connected to NeonDB in minutes!

## 🚀 Step 1: Create NeonDB Account

1. Go to [NeonDB Console](https://console.neon.tech/)
2. Sign up with GitHub, Google, or email
3. It's free! No credit card required for the free tier

## 🏗️ Step 2: Create Your Project

1. Click **"Create Project"**
2. **Project Name:** `spin-hobby`
3. **PostgreSQL Version:** Use default (latest)
4. **Region:** Choose closest to you (e.g., US East, EU West)
5. Click **"Create Project"**

## 🔑 Step 3: Get Your Database Credentials

After creating the project, you'll see the **Connection Details** page.

### Option A: Individual Credentials (Recommended)

Copy these values to your `.env` file:

```bash
# NeonDB Configuration
DB_HOST=ep-your-project-xxx.region.aws.neon.tech
DB_PORT=5432
DB_NAME=neondb
DB_USER=your_username
DB_PASSWORD=your_password
```

### Option B: Connection String

Alternatively, copy the full connection string:

```bash
DATABASE_URL=postgresql://username:password@hostname/database?sslmode=require
```

## 📝 Step 4: Create Your .env File

Create `spin-hobby-server/.env` with your NeonDB credentials:

```bash
# NeonDB Configuration (replace with your actual values)
DB_HOST=ep-cool-cloud-123456.us-east-1.aws.neon.tech
DB_PORT=5432
DB_NAME=neondb
DB_USER=your_username_here
DB_PASSWORD=your_password_here

# Express Server Configuration
EXPRESS_PORT=8001
NODE_ENV=development

# JWT Secret (generate with the command below)
JWT_SECRET=your_secure_jwt_secret_here

# Square API Configuration (add later)
SQUARE_APPLICATION_ID=your_square_application_id
SQUARE_APPLICATION_SECRET=your_square_application_secret
SQUARE_ACCESS_TOKEN=your_square_access_token
SQUARE_ENVIRONMENT=sandbox
```

## 🔐 Step 5: Generate JWT Secret

Run this command to generate a secure JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output and paste it as your `JWT_SECRET`.

## ✅ Step 6: Test Your Connection

```bash
# Test database connection
npm run db:test
```

You should see:

```
🔌 Testing database connection...
📍 Host: ep-your-project.neon.tech:5432
🗄️  Database: neondb
👤 User: your_username
🌟 Using NeonDB (SSL enabled)
✅ Database connection successful!
🎯 PostgreSQL version: PostgreSQL 15.x...
```

## 🗄️ Step 7: Run Migrations

```bash
# Create all Square integration tables
npm run migrate:reset

# Check status
npm run migrate:status
```

## 🎉 Step 8: Start Development

```bash
# Start your anime store server
npm run dev
```

## 📍 Where to Find Credentials Later

If you need to find your credentials again:

1. Go to [NeonDB Console](https://console.neon.tech/)
2. Click on your `spin-hobby` project
3. Go to **"Dashboard"** tab
4. Click **"Connection Details"** or scroll down to **"Connection string"**

## 🎯 NeonDB Free Tier Limits

Perfect for development:

- ✅ **1 project**
- ✅ **10 databases** per project
- ✅ **1 GB storage**
- ✅ **100 hours compute** per month
- ✅ **Automatic scaling**
- ✅ **Automatic backups**

## 🔧 Troubleshooting

### "Database connection failed"

- ✅ Check DB_HOST ends with `.neon.tech`
- ✅ Verify DB_USER and DB_PASSWORD are correct
- ✅ Make sure your NeonDB project is active
- ✅ Check you're using the right database name (usually `neondb`)

### "SSL connection error"

- ✅ Our scripts automatically handle SSL for NeonDB
- ✅ Make sure DB_HOST contains `.neon.tech`

### "Authentication failed"

- ✅ Double-check username and password
- ✅ Copy-paste to avoid typos
- ✅ Check if password contains special characters (wrap in quotes)

## 🌟 Why NeonDB for Your Anime Store?

- **🚀 Serverless:** No server management
- **⚡ Fast:** Instant cold starts
- **🔄 Autoscaling:** Handles traffic spikes
- **💾 Branching:** Create database branches like Git
- **🛡️ Secure:** Built-in SSL and backups
- **💰 Cost-effective:** Free tier + pay-as-you-scale

Your Square-integrated anime merchandise store database is ready to rock! 🎌✨
