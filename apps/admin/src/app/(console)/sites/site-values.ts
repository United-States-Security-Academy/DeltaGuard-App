import { DEFAULT_CLOCK_IN_RADIUS_M, type SiteContact } from '@deltaguard/shared';

// The site form's values. Kept out of site-form.tsx ('use client') so server
// pages can read EMPTY_SITE: a value imported from a client module is only a
// reference on the server, not the object.

export type SiteValues = {
  id?: string;
  clientId: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  radius: number;
  emergencyInstructions: string;
  contacts: SiteContact[];
  active: boolean;
};

export const EMPTY_SITE: SiteValues = {
  clientId: '',
  name: '',
  address: '',
  latitude: null,
  longitude: null,
  radius: DEFAULT_CLOCK_IN_RADIUS_M,
  emergencyInstructions: '',
  contacts: [],
  active: true,
};
