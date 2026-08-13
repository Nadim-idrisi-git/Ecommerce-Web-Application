import express from 'express'
import cors from 'cors';
import 'dotenv/config'
import connectDB from './config/mongodb.js'
import connectCloudinary from './config/cloudinary.js'
import userRouter from './routes/userRoute.js'
import productRouter from './routes/productRoute.js'
import orderRouter from './routes/orderRoute.js'
import path from 'path'
import chatRouter from "./routes/chatRoute.js";
import voiceRouter from "./routes/voiceRoute.js";
// App config
const app = express()
const port = process.env.PORT || 4000
const defaultAllowedOrigins = [
  "https://idris-topaz.vercel.app",
  "https://idris-frontend-ten.vercel.app",
  "https://idris-admin-ebon.vercel.app",
  "https://idris-admin-nu.vercel.app",
]
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
  ...defaultAllowedOrigins,
  "http://localhost:5173",
  "http://localhost:5174",
]
  .filter(Boolean)
  .map((origin) => origin.replace(/\/+$/, ""))

const allowedVercelAppPattern = /^https:\/\/idris-(frontend|admin)(-[a-z0-9-]+)?\.vercel\.app$/i

const isAllowedOrigin = (origin) => {
  if (!origin) return true

  const cleanOrigin = origin.replace(/\/+$/, "")
  return allowedOrigins.includes(cleanOrigin) || allowedVercelAppPattern.test(cleanOrigin)
}

connectCloudinary()

// middlewares
app.use(express.json())
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
  next()
})
app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true)
    }

    return callback(new Error("Not allowed by CORS"))
  },
  credentials: true,
}))
app.use(async (req, res, next) => {
  if (req.path === "/") return next()

  try {
    await connectDB()
    next()
  } catch (error) {
    console.error("MongoDB connection failed:", error.message)
    res.status(503).json({ success: false, message: "Database connection unavailable" })
  }
})
app.use('/assets', express.static(path.resolve(process.cwd(), '../idris-frontend/src/assets'), {
  maxAge: "30d",
  immutable: true,
}))


// api endpoints
app.use('/api/user', userRouter);
app.use('/api/product', productRouter);
app.use('/api/order', orderRouter);
app.use("/api/chat", chatRouter);
app.use("/api/voice", voiceRouter);
app.get('/', (req, res) => {
  res.json("API working!")
})

if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`Server started on PORT : ` + port))
}

export default app
