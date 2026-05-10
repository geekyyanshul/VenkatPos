import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { OutletProvider } from './context/OutletContext';
import OutletSelector from './pages/OutletSelector';
import OrderList from './pages/OrderList';
import CreateOrder from './pages/CreateOrder';
import OrderDetail from './pages/OrderDetail';
import OfflineIndicator from './components/OfflineIndicator';
import LiveEventsPanel from './components/LiveEventsPanel';
import './App.css';

export default function App() {
  return (
    <OutletProvider>
      <BrowserRouter>
        <OfflineIndicator />
        <LiveEventsPanel />
        <Routes>
          <Route path="/" element={<OutletSelector />} />
          <Route path="/orders" element={<OrderList />} />
          <Route path="/orders/new" element={<CreateOrder />} />
          <Route path="/orders/:orderId" element={<OrderDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </OutletProvider>
  );
}