'use client';

import React, { createContext, useContext, useEffect, useReducer } from 'react';
import { useRouter } from 'next/navigation';
import api from '../lib/api';

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
      const res = await api.get('/auth/check-auth');
      if (!res?.data?.success || !res?.data?.user) {
        dispatch({ type: ACTIONS.FAILURE, payload: null });
        return { success: false };
      }

      const user = buildUserPayload(res.data.user);
      dispatch({ type: ACTIONS.SUCCESS, payload: { user } });
      return { success: true, user };
    } catch (err) {
      dispatch({ type: ACTIONS.FAILURE, payload: err.response?.data || { message: err.message } });
      return { success: false };
    }
  };

  const register = async ({ email, password, userName }) => {
    dispatch({ type: ACTIONS.LOADING });
    try {
      const res = await api.post('/auth/register', { email, password, userName });
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
      const res = await api.post('/auth/login', { email, password });
      if (!res?.data?.success || !res?.data?.user) {
        const err = res?.data || { message: 'Login failed' };
        dispatch({ type: ACTIONS.FAILURE, payload: err });
        return { success: false, ...err };
      }

      const user = buildUserPayload(res.data.user);
      dispatch({ type: ACTIONS.SUCCESS, payload: { user } });

      return { success: true, user };
    } catch (err) {
      const payload = err.response?.data || { message: err.message || 'Login failed' };
      dispatch({ type: ACTIONS.FAILURE, payload });
      return { success: false, ...payload };
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (_) {
      // Even if logout endpoint fails, clear local auth state.
    }
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
    <AuthContext.Provider value={{ ...state, register, login, logout, checkAuth, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
