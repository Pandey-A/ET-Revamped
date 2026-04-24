
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Issues from './Issues';

const Index = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    // Redirect to issues page when landing on root
    navigate('/', { replace: true });
  }, [navigate]);

  return <Issues />;
};

export default Index;
