import { createContext, useContext, useState } from 'react';

const OutletContext = createContext(null);

export function OutletProvider({ children }) {
  const [outlet, setOutlet] = useState(null);
  return (
    <OutletContext.Provider value={{ outlet, setOutlet }}>
      {children}
    </OutletContext.Provider>
  );
}

export function useOutlet() {
  return useContext(OutletContext);
}
