import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getOutlets } from '../api/outlets';
import { useOutlet } from '../context/OutletContext';

export default function OutletSelector() {
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { setOutlet } = useOutlet();
  const navigate = useNavigate();

  useEffect(() => {
    getOutlets()
      .then(setOutlets)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function selectOutlet(outlet) {
    setOutlet(outlet);
    navigate('/orders');
  }

  if (loading) return <div className="page-center"><p>Loading outlets…</p></div>;
  if (error) return <div className="page-center"><p className="error-msg">{error}</p></div>;

  return (
    <div className="page-center">
      <div className="outlet-selector">
        <h1>POS System</h1>
        <p className="subtitle">Select your outlet to continue</p>
        <div className="outlet-grid">
          {outlets.map(o => (
            <button
              key={o.outlet_id}
              className="outlet-card"
              onClick={() => selectOutlet(o)}
            >
              <span className="outlet-name">{o.name}</span>
              <span className="outlet-tax">Tax: {(parseFloat(o.tax_rate) * 100).toFixed(0)}%</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
