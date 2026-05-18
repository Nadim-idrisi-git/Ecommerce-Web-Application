import express from 'express';
import { loginUser,registerUser,getProfile,getCart,updateCart,getAddresses,addAddress,updateAddress,deleteAddress,setDefaultAddress,forgotPassword,resetPassword,adminLogin } from '../controllers/userController.js';
import authUser from '../middleware/authUser.js';

const userRouter = express.Router();

userRouter.post('/login', loginUser);
userRouter.post('/register', registerUser);
userRouter.get('/profile', authUser, getProfile);
userRouter.get('/cart', authUser, getCart);
userRouter.post('/cart', authUser, updateCart);
userRouter.get('/address', authUser, getAddresses);
userRouter.post('/address', authUser, addAddress);
userRouter.put('/address', authUser, updateAddress);
userRouter.delete('/address', authUser, deleteAddress);
userRouter.post('/address/default', authUser, setDefaultAddress);
userRouter.post('/forgot-password', forgotPassword);
userRouter.post('/reset-password', resetPassword);
userRouter.post('/admin', adminLogin);

export default userRouter;
