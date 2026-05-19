import axios from 'axios';
import React from 'react'
import { backendUrl } from '../App';
import { toast } from 'react-toastify';

const Login = ({ setToken }) => {

    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');

    const onSubmitHandler = async (e) => {
        try {
            e.preventDefault();
            // Your login logic here
            const response = await axios.post(backendUrl + '/api/user/admin', {email, password});
            if(response.data.success) {
                // Store the token in localStorage or state
                setToken(response.data.token);
            } else {
                toast.error(response.data.message || 'Login failed. Please try again.');
            }


        } catch (error) {
            console.error('Admin login failed:', error.response?.data?.message || error.message);
            toast.error(error.message || 'An error occurred. Please try again.');
        }
    };

  return (
    <div className='min-h-screen flex items-center justify-center w-full px-4'>
      <div className='bg-white shadow-md rounded-lg px-5 sm:px-8 py-6 w-full max-w-md'>
        <h1 className='text-2xl font-bold mb-4'>
            Admin Panel
        </h1>
        <form onSubmit={onSubmitHandler}>
            <div className='mb-3 w-full'>
                <p className='text-sm font-medium text-gray-700 mb-2'>Email Address</p>
                <input onChange={(e) => setEmail(e.target.value)} value={email}
                    className="border border-gray-300 rounded-md w-full px-3 py-2 focus:outline-none" 
                    type="email" 
                    placeholder='Enter your email address' 
                    required 
                    
                    
                />
            </div>

            <div className='mb-3 w-full'>
                <p className='text-sm font-medium text-gray-700 mb-2'>Password</p>
                <input onChange={(e) => setPassword(e.target.value)} value={password}
                    className="border border-gray-300 rounded-md w-full px-3 py-2 focus:outline-none" 
                    type="password" 
                    placeholder='Enter your password' 
                    required 
                />
            </div>

            <div>
                <button className="bg-blue-500 hover:bg-blue-700 text-white w-full font-bold py-2 px-4 rounded" type='submit'>Login</button>
            </div>

        </form>
      </div>
    </div>
  )
}

export default Login
