import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { DonorDashboard } from './pages/dashboards/DonorDashboard';
import { HospitalDashboard } from './pages/dashboards/HospitalDashboard';
import { BloodBankDashboard } from './pages/dashboards/BloodBankDashboard';
import { AdminDashboard } from './pages/dashboards/AdminDashboard';
import { UnauthorizedPage } from './pages/UnauthorizedPage';
import { UnprovisionedPage } from './pages/UnprovisionedPage';
import { InactivePage } from './pages/InactivePage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="app-container">
          <Routes>
            {/* Public Auth Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />
            <Route path="/unprovisioned" element={<UnprovisionedPage />} />
            <Route path="/inactive" element={<InactivePage />} />

            {/* Protected Role-Specific Dashboards */}
            <Route
              path="/donor"
              element={
                <ProtectedRoute allowedRoles={['DONOR']}>
                  <DonorDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/hospital"
              element={
                <ProtectedRoute allowedRoles={['HOSPITAL']}>
                  <HospitalDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/blood-bank"
              element={
                <ProtectedRoute allowedRoles={['BLOOD_BANK']}>
                  <BloodBankDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            {/* Default Catch-all */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
