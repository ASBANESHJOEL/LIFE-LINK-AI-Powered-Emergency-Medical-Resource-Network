'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  ShieldAlert,
  Database,
  MapPin,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../../../../lib/supabase/auth-context';
import { api } from '../../../../../lib/api/client';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Select } from '../../../../../components/ui/select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../../../../components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '../../../../../components/ui/alert';
import { BloodGroup, ResourceType, UrgencyLevel } from '../../../../../types/requests';

export default function NewEmergencyRequestPage() {
  const router = useRouter();
  const { organization } = useAuth();

  const [bloodGroup, setBloodGroup] = useState<BloodGroup>('O-');
  const [quantity, setQuantity] = useState<number>(2);
  const [resourceType, setResourceType] = useState<ResourceType>('PACKED_RED_CELLS');
  const [urgency, setUrgency] = useState<UrgencyLevel>('CRITICAL');

  // Default to organization hospital coordinates if available, or regional medical center coords
  const [latitude, setLatitude] = useState<number>(organization?.hospital?.latitude || 12.9716);
  const [longitude, setLongitude] = useState<number>(organization?.hospital?.longitude || 77.5946);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (quantity < 1) {
      setErrorMessage('Quantity must be at least 1 unit.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const result = await api.requests.create({
        blood_group: bloodGroup,
        quantity: Number(quantity),
        resource_type: resourceType,
        urgency: urgency,
        hospital_latitude: Number(latitude),
        hospital_longitude: Number(longitude),
      });

      if (result && result.request?.id) {
        // Immediately navigate to the resolution workspace
        router.push(`/hospital/requests/${result.request.id}`);
      } else {
        throw new Error('Failed to create emergency request record.');
      }
    } catch (err: unknown) {
      console.error('Create request error:', err);
      const message = err instanceof Error ? err.message : 'Failed to broadcast emergency request.';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/hospital/dashboard">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Command Center
          </Button>
        </Link>
      </div>

      <div className="border-l-4 border-red-600 pl-4">
        <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
          <AlertOctagon className="w-6 h-6 text-red-500" />
          Broadcast Emergency Blood Request
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Initiate priority allocation protocol across internal reserve, peer blood banks, and verified volunteer donor pool.
        </p>
      </div>

      <Card className="border-slate-800 bg-slate-900/90 shadow-2xl backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-base">Trauma Patient & Resource Specification</CardTitle>
          <CardDescription>
            All requests immediately trigger automatic inventory reservations and SLA tracking timers.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {errorMessage && (
            <Alert variant="destructive">
              <ShieldAlert className="w-4 h-4" />
              <AlertTitle>Submission Error</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <form id="emergency-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Target Blood Group"
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value as BloodGroup)}
                required
              >
                <option value="O-">O Negative (Universal Donor - Critical)</option>
                <option value="O+">O Positive</option>
                <option value="A-">A Negative</option>
                <option value="A+">A Positive</option>
                <option value="B-">B Negative</option>
                <option value="B+">B Positive</option>
                <option value="AB-">AB Negative</option>
                <option value="AB+">AB Positive</option>
              </Select>

              <Select
                label="Component Type"
                value={resourceType}
                onChange={(e) => setResourceType(e.target.value as ResourceType)}
                required
              >
                <option value="PACKED_RED_CELLS">Packed Red Blood Cells (PRBC)</option>
                <option value="WHOLE_BLOOD">Whole Blood</option>
                <option value="PLATELETS">Platelet Concentrate (RDP/SDP)</option>
                <option value="FRESH_FROZEN_PLASMA">Fresh Frozen Plasma (FFP)</option>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Requested Quantity (Units)"
                type="number"
                min={1}
                max={20}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                required
              />

              <Select
                label="Urgency Protocol"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as UrgencyLevel)}
                required
              >
                <option value="CRITICAL">CRITICAL — Severe Hemorrhage (&lt; 15 min)</option>
                <option value="URGENT">URGENT — Urgent Surgery (&lt; 2 hours)</option>
                <option value="STANDARD">STANDARD — Elective / Scheduled Reserve</option>
              </Select>
            </div>

            <div className="pt-4 border-t border-slate-800">
              <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-sky-400" />
                Delivery Geocoordinates (Trauma Facility Location)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Latitude"
                  type="number"
                  step="0.000001"
                  value={latitude}
                  onChange={(e) => setLatitude(Number(e.target.value))}
                  required
                />
                <Input
                  label="Longitude"
                  type="number"
                  step="0.000001"
                  value={longitude}
                  onChange={(e) => setLongitude(Number(e.target.value))}
                  required
                />
              </div>
            </div>
          </form>
        </CardContent>

        <CardFooter className="flex justify-between items-center bg-slate-950/40 border-t border-slate-800/80 p-6">
          <Link href="/hospital/dashboard">
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            form="emergency-form"
            variant="default"
            size="lg"
            isLoading={loading}
            className="gap-2 px-8"
          >
            Dispatch to Resolution Engine
            <ArrowRight className="w-4 h-4" />
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
