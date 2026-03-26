'use client';

import React, { createContext, useContext, useEffect, useReducer } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import api from '../lib/api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const AuthContext = createContext();

const initialState = { user: null, isAuthenticated: false, isLoading: true, error: null };
const ACTIONS = { LOADING: 'LOADING', SUCCESS: 'SUCCESS', FAILURE: 'FAILURE', LOGOUT: 'LOGOUT', SET_USER: 'SET_USER' };

function reducer(state, action) {
  switch (action.type) {
    case ACTIONS.LOADING: return { ...state, isLoading: true, error: null };
    case ACTIONS.SUCCESS: return { ...state, isLoading: false, user: action.payload?.user ?? null, isAuthenticated: !!action.payload?.user, error: null };
    case ACTIONS.FAILURE: return { ...state, isLoading: false, user: null, isAuthenticated: false, error: action.payload || null };
    case ACTIONS.LOGOUT: return { user: null, isAuthenticated: false, isLoading: false, error: null };
    case ACTIONS.SET_USER: return { ...state, user: action.payload, isAuthenticated: !!action.payload };
    default: return state;
  }
}

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const router = useRouter();

  // Helper to build the same user shape the frontend expects
  const buildUserPayload = (profile) => {
    const analysisLimit = profile.analysis_request_limit || 5;
    const used = profile.analysis_requests_used || 0;
    return {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      userName: profile.user_name,
      isEmailVerified: !!profile.is_email_verified,
      isBlocked: !!profile.is_blocked,
      blockedUntil: profile.blocked_until,
      analysisRequestsUsed: used,
      analysisRequestLimit: analysisLimit,
      remainingAnalysisRequests: Math.max(analysisLimit - used, 0),
      upgradeRequired: used >= analysisLimit,
    };
  };

  const checkAuth = async () => {
    dispatch({ type: ACTIONS.LOADING });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        dispatch({ type: ACTIONS.FAILURE, payload: null });
        return { success: false };
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (error || !profile) {
        dispatch({ type: ACTIONS.FAILURE, payload: { message: 'Profile not found' } });
        return { success: false };
      }

      const user = buildUserPayload(profile);
      dispatch({ type: ACTIONS.SUCCESS, payload: { user } });
      return { success: true, user };
    } catch (err) {
      dispatch({ type: ACTIONS.FAILURE, payload: { message: err.message } });
      return { success: false };
    }
  };

  const register = async ({ email, password, userName }) => {
    dispatch({ type: ACTIONS.LOADING });
    try {
      // In native mode, we call our Edge Function for registration 
      // because we still need to insert into our 'profiles' table with custom fields
      // and handle custom email verification.
      const res = await api.post('/register', { email, password, userName });
      // Registration successful response from Edge Function
      return res.data;
    } catch (err) {
      const payload = err.response?.data || { message: 'Registration failed' };
      dispatch({ type: ACTIONS.FAILURE, payload });
      return payload;
    }
  };

  const login = async ({ email, password }) => {
    dispatch({ type: ACTIONS.LOADING });
    try {
      // 1. Sign in with Supabase Auth
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;

      // 2. Fetch profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (profileError) throw profileError;

      // Check block/verify (mirrors backend logic)
      if (!profile.is_email_verified) {
        await supabase.auth.signOut();
        const err = { message: 'Please verify your email before logging in.', code: 'EMAIL_NOT_VERIFIED' };
        dispatch({ type: ACTIONS.FAILURE, payload: err });
        return { success: false, ...err };
      }

      if (profile.is_blocked) {
        await supabase.auth.signOut();
        const err = { message: 'Account is blocked', blocked: true, blockedUntil: profile.blocked_until };
        dispatch({ type: ACTIONS.FAILURE, payload: err });
        return { success: false, ...err };
      }

      const user = buildUserPayload(profile);
      dispatch({ type: ACTIONS.SUCCESS, payload: { user } });
      
      if (user.role === 'admin') router.push('/admin');
      else router.push('/upload');

      return { success: true, user };
    } catch (err) {
      const payload = { message: err.message || 'Login failed' };
      dispatch({ type: ACTIONS.FAILURE, payload });
      return { success: false, ...payload };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    dispatch({ type: ACTIONS.LOGOUT });
    router.push('/login');
  };

  const setUser = (nextUser) => {
    const resolvedUser = typeof nextUser === 'function' ? nextUser(state.user) : nextUser;
    dispatch({ type: ACTIONS.SET_USER, payload: resolvedUser });
  };

  useEffect(() => {
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, register, login, logout, checkAuth, setUser, supabase }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
