// src/Auth.jsx
import { useState } from 'react';
import axios from 'axios';
import { Activity, Lock, Mail, User, ArrowRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Auth({ setToken }) {
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Determine endpoint based on whether we are logging in or signing up
      // *Make sure these URLs match your backend user routes!*
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const url = `http://localhost:5003${endpoint}`;

      const response = await axios.post(url, formData);

      // Save the token to localStorage and update state
      const token = response.data.token;
      localStorage.setItem('medinsight_token', token);
      setToken(token);
      
      // Send them to the dashboard
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.message || 'An error occurred during authentication.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans text-stone-800">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center items-center">
          <Activity className="text-amber-900 mr-3" size={36} strokeWidth={2.5} />
          <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-900 to-amber-700 bg-clip-text text-transparent tracking-tight">MedInsight</h1>
        </div>
        <h2 className="mt-6 text-center text-xl font-medium text-stone-600">
          {isLogin ? 'Sign in to your account' : 'Create a new account'}
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm border border-stone-200 sm:rounded-2xl sm:px-10">
          
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg text-center">
              {error}
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit}>
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-stone-700">Full Name</label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-stone-400" />
                  </div>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="block w-full pl-10 pr-3 py-2.5 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-900/20 focus:border-amber-900 bg-stone-50 transition-colors sm:text-sm outline-none"
                    placeholder="Dr. Jane Doe"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-stone-700">Email address</label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-stone-400" />
                </div>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  className="block w-full pl-10 pr-3 py-2.5 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-900/20 focus:border-amber-900 bg-stone-50 transition-colors sm:text-sm outline-none"
                  placeholder="you@hospital.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700">Password</label>
              <div className="mt-1 relative rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-stone-400" />
                </div>
                <input
                  type="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  className="block w-full pl-10 pr-3 py-2.5 border border-stone-200 rounded-xl focus:ring-2 focus:ring-amber-900/20 focus:border-amber-900 bg-stone-50 transition-colors sm:text-sm outline-none"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-amber-900 hover:bg-amber-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-900 transition-colors disabled:opacity-70"
            >
              {isLoading ? (
                <Loader2 className="animate-spin h-5 w-5" />
              ) : (
                <>
                  {isLogin ? 'Sign In' : 'Create Account'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
              }}
              className="text-sm text-amber-900 hover:text-amber-700 font-medium"
            >
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}