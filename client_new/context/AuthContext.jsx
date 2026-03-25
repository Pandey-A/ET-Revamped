'use client';

import React, { createContext, useContext, useEffect, useReducer } from 'react';
import api from '../lib/api';
import { useRouter } from 'next/navigation';

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

  const checkAuth = async (options = {}) => {
    const { force = false } = options;
    if (state.isAuthenticated && !force) return { success: true, user: state.user };
    dispatch({ type: ACTIONS.LOADING });
    try {
      const res = await api.get('/auth/check-auth', { headers: { 'Cache-Control': 'no-store' } });
      dispatch({ type: ACTIONS.SUCCESS, payload: res.data });
      return res.data;
    } catch (err) {
      const payload = err.response?.data || { message: 'Unauthorized' };
      dispatch({ type: ACTIONS.FAILURE, payload });
      return payload;
    }
  };

  const setUser = (nextUser) => {
    const resolvedUser = typeof nextUser === 'function' ? nextUser(state.user) : nextUser;
    dispatch({ type: ACTIONS.SET_USER, payload: resolvedUser });
  };

  const register = async (form) => {
    dispatch({ type: ACTIONS.LOADING });
    try {
      const res = await api.post('/auth/register', form);
      dispatch({ type: ACTIONS.SUCCESS, payload: { user: res.data.user } });
      return res.data;
    } catch (err) {
      const payload = err.response?.data || { message: 'Register failed' };
      dispatch({ type: ACTIONS.FAILURE, payload });
      return payload;
    }
  };

  const login = async (form) => {
    dispatch({ type: ACTIONS.LOADING });
    try {
      const res = await api.post('/auth/login', form);
      dispatch({ type: ACTIONS.SUCCESS, payload: res.data });

      if (res.data?.success && res.data?.user) {
        const role = res.data.user.role;
        if (role === 'admin') router.push('/admin');
        else router.push('/upload');
      }
      return res.data;
    } catch (err) {
      const status = err?.response?.status;
      const payload = err?.response?.data || { message: 'Login failed' };

      if (status === 403 && payload?.blocked) {
        const q = new URLSearchParams({
          message: payload.message || 'Your account is blocked.',
          blockedUntil: payload.blockedUntil ?? '',
        });
        router.push(`/blocked?${q.toString()}`);
        dispatch({ type: ACTIONS.FAILURE, payload });
        return payload;
      }

      if (status === 403) {
        const q = new URLSearchParams({
          message: payload.message || 'Your account is blocked or access is forbidden.',
          blockedUntil: payload.blockedUntil ?? '',
        });
        router.push(`/blocked?${q.toString()}`);
        dispatch({ type: ACTIONS.FAILURE, payload });
        return payload;
      }

      dispatch({ type: ACTIONS.FAILURE, payload });
      return payload;
    }
  };

  const logout = async () => {
    dispatch({ type: ACTIONS.LOADING });
    try {
      await api.post('/auth/logout', {});
      dispatch({ type: ACTIONS.LOGOUT });
      router.push('/login');
    } catch (err) {
      dispatch({ type: ACTIONS.FAILURE, payload: err.response?.data || { message: 'Logout failed' } });
    }
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
