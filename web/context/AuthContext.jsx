'use client';

import React, { createContext, useContext, useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import api from '../lib/api';
import { setAccessToken, clearAccessToken } from '../lib/authToken';

function isAbortError(err) {
  return err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
}

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
  /** Bumps when login/register/logout start so a slow / stale session check cannot overwrite newer auth. */
  const authEpoch = useRef(0);

  // Helper to build the same user shape the frontend expects
  const buildUserPayload = (profile) => {
    if (!profile) return null;
    const analysisLimit = Number(
      profile.analysis_request_limit ?? profile.analysisRequestLimit ?? 5,
    );
    const used = Number(profile.analysis_requests_used ?? profile.analysisRequestsUsed ?? 0);
    return {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      userName: profile.user_name ?? profile.userName,
      isEmailVerified: !!(profile.is_email_verified ?? profile.isEmailVerified),
      isBlocked: !!(profile.is_blocked ?? profile.isBlocked),
      blockedUntil: profile.blocked_until ?? profile.blockedUntil ?? null,
      analysisRequestsUsed: used,
      analysisRequestLimit: analysisLimit,
      remainingAnalysisRequests: Math.max(analysisLimit - used, 0),
      upgradeRequired: used >= analysisLimit,
    };
  };

  const checkAuth = async (signal) => {
    const epochAtStart = authEpoch.current;
    dispatch({ type: ACTIONS.LOADING });
    try {
      const res = await api.get('/auth/check-auth', { signal });
      if (epochAtStart !== authEpoch.current) {
        return { success: false, stale: true };
      }
      if (!res?.data?.success || !res?.data?.user) {
        dispatch({ type: ACTIONS.FAILURE, payload: null });
        return { success: false };
      }

      const user = buildUserPayload(res.data.user);
      dispatch({ type: ACTIONS.SUCCESS, payload: { user } });
      return { success: true, user };
    } catch (err) {
      if (isAbortError(err)) {
        return { success: false, aborted: true };
      }
      if (epochAtStart !== authEpoch.current) {
        return { success: false, stale: true };
      }
      if (err.response?.status === 401) {
        clearAccessToken();
      }
      dispatch({ type: ACTIONS.FAILURE, payload: err.response?.data || { message: err.message } });
      return { success: false };
    }
  };

  const register = async ({ email, password, userName }) => {
    authEpoch.current += 1;
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
    authEpoch.current += 1;
    dispatch({ type: ACTIONS.LOADING });
    try {
      const res = await api.post('/auth/login', { email, password });
      if (!res?.data?.success || !res?.data?.user) {
        const err = res?.data || { message: 'Login failed' };
        dispatch({ type: ACTIONS.FAILURE, payload: err });
        return { success: false, ...err };
      }

      const user = buildUserPayload(res.data.user);
      if (res.data.accessToken) {
        setAccessToken(res.data.accessToken);
      }
      dispatch({ type: ACTIONS.SUCCESS, payload: { user } });

      return { success: true, user };
    } catch (err) {
      const payload = err.response?.data || { message: err.message || 'Login failed' };
      dispatch({ type: ACTIONS.FAILURE, payload });
      return { success: false, ...payload };
    }
  };

  const logout = async () => {
    authEpoch.current += 1;
    clearAccessToken();
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
    const ac = new AbortController();
    checkAuth(ac.signal);
    return () => ac.abort();
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
