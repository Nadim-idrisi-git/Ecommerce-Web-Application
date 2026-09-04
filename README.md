# IDRIS — AI-Powered E-Commerce Platform

**IDRIS** is a modern, full-stack e-commerce platform built with the **MERN Stack**, enhanced with an AI-powered conversational shopping assistant.

It allows users to discover trendy and fashionable clothing, search products using natural language, receive AI-powered recommendations, manage their cart and orders, and interact with the website using **voice-based AI assistance**.

The platform is fully responsive and optimized for **desktop, tablet, and mobile devices**.

## Live Demo

**Website:** https://idris-frontend-ten.vercel.app/

## Features

### E-Commerce

- Modern responsive e-commerce interface
- Browse trendy clothing collections
- Product search and filtering
- Detailed product pages with multiple images
- Product image zoom and preview
- Add, update, and remove cart items
- Persistent shopping cart
- User registration and login
- JWT authentication and authorization
- Secure order placement and management
- Admin product management
- Cloudinary-based product image management
- RESTful APIs for frontend-backend communication

### AI Shopping Assistant

- AI-powered conversational shopping assistant
- Natural-language product search
- AI-powered product recommendations
- Context-aware shopping assistance
- RAG-based product information retrieval
- Grounded responses using product data
- AI agent orchestration
- Controlled tool-based AI interactions
- Voice input using speech recognition
- Neural text-to-speech responses
- Hands-free shopping experience
- Graceful text fallback when voice output is unavailable

## AI Assistant Flow

```text
User
  ↓
Voice / Text Input
  ↓
React AI Assistant
  ↓
Backend API
  ↓
AI Agent Orchestrator
  ↓
Product Search / Recommendation / RAG
  ↓
Grounded Product Data
  ↓
AI Response
  ↓
Text + Neural Voice
```

## Application Architecture

```text
User
 ↓
React + Vite Frontend
 ↓
Node.js + Express.js Backend
 ↓
 ├── MongoDB
 ├── Cloudinary
 └── AI / LLM
       ↓
   RAG + AI Tools
       ↓
 Product Search & Recommendations
```

## Tech Stack

### Frontend

- React.js
- Vite
- JavaScript
- Tailwind CSS
- React Router
- Context API
- Web Speech API

### Backend

- Node.js
- Express.js
- REST APIs
- JWT Authentication
- Multer
- AI Agent Orchestration
- RAG Pipeline

### Database & Services

- MongoDB
- Mongoose
- Cloudinary
- AI / LLM API
- Neural Text-to-Speech API

### Development & Deployment

- Git & GitHub
- Postman
- Vercel
- Render

## AI Capabilities

The IDRIS AI Assistant uses a controlled, tool-based architecture to provide reliable shopping assistance.

Users can ask queries such as:

```text
"Suggest something for winter."

"Show me black oversized t-shirts."

"Find something trendy under ₹1500."

"I need a casual outfit for college."

"Recommend something for a party."
```

The assistant can understand the user's query, retrieve relevant product information, execute approved tools, and generate a grounded response.

## Project Highlights

IDRIS demonstrates practical experience in building a complete **MERN Stack e-commerce application** with modern AI capabilities.

Key areas include:

- Full-stack MERN development
- REST API development
- JWT authentication
- MongoDB database management
- Cloudinary image management
- Shopping cart and order management
- Admin product management
- AI/LLM integration
- RAG-based product retrieval
- AI agent orchestration
- Tool calling
- Voice input and output
- Responsive UI development
- Production deployment

## Future Improvements

- Online payments
- Product reviews and ratings
- Wishlist
- Coupons and discounts
- Advanced order tracking
- Personalized recommendations
- Semantic product search
- Multilingual voice assistant
- AI-powered visual product search
- Advanced conversational memory

## Project Status

**Active Development**

IDRIS is continuously being improved with new AI capabilities, voice interactions, UI enhancements, performance optimizations, RAG improvements, agent reliability, and production hardening.

## Author

**Nadim Idrisi**

B.Tech Graduate | MERN Stack Developer | Java & DSA | AI Integration

## License

This project is developed for educational, portfolio, and demonstration purposes.
