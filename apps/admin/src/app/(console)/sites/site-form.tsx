'use client';

import { DEFAULT_CLOCK_IN_RADIUS_M, type SiteContact } from '@deltaguard/shared';
import { useActionState, useState } from 'react';

import { Button, Field, FormMessage, Select, Textarea } from '@/components/ui';

import { createSite, updateSite } from './actions';
import { MapPicker, roundCoord } from './map-picker';

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

type ContactRow = { name: string; role: string; phone: string; email: string };

/**
 * Create (no id) or edit (with id) a site. `clients` is passed only to admins:
 * supervisors can edit a site but not move it to another client.
 */
export function SiteForm({
  values,
  clients,
  fallbackCenter,
}: {
  values: SiteValues;
  clients: { id: string; name: string }[] | null;
  fallbackCenter: [number, number] | null;
}) {
  const editing = Boolean(values.id);
  const [state, action, pending] = useActionState(editing ? updateSite : createSite, null);
  const err = state?.fieldErrors ?? {};

  // Inputs keep their raw text so typing "6." doesn't get rewritten.
  const [lat, setLat] = useState(values.latitude?.toString() ?? '');
  const [lng, setLng] = useState(values.longitude?.toString() ?? '');
  const [radius, setRadius] = useState(String(values.radius));
  const [focusKey, setFocusKey] = useState(0);
  const [contacts, setContacts] = useState<ContactRow[]>(
    values.contacts.map((c) => ({
      name: c.name,
      role: c.role ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
    })),
  );

  const parsedLat = parseCoord(lat, 90);
  const parsedLng = parseCoord(lng, 180);
  const pin = parsedLat !== null && parsedLng !== null;
  const radiusNumber = Math.min(5000, Math.max(25, Number(radius) || DEFAULT_CLOCK_IN_RADIUS_M));

  function pick(latitude: number, longitude: number, focus = false) {
    setLat(String(latitude));
    setLng(String(longitude));
    if (focus) setFocusKey((k) => k + 1);
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {clients ? (
          <Select
            label="Client"
            name="client_id"
            defaultValue={values.clientId}
            required
            aria-invalid={err.client_id ? true : undefined}
          >
            <option value="" disabled>
              Choose a client…
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Field label="Site name" name="name" required defaultValue={values.name} error={err.name} />
        <div className="sm:col-span-2">
          <Textarea
            label="Address"
            name="address"
            rows={2}
            defaultValue={values.address}
            error={err.address}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 font-semibold">Location and clock-in radius</legend>
        <p className="text-sm text-slate-500">
          Search for the address, or click the map to place the pin. Drag the pin to adjust it.
          Officers can only clock in inside the gold circle.
        </p>
        <AddressSearch onFound={(la, lo) => pick(la, lo, true)} />
        <MapPicker
          latitude={pin ? parsedLat : null}
          longitude={pin ? parsedLng : null}
          radius={radiusNumber}
          fallbackCenter={fallbackCenter}
          focusKey={focusKey}
          onPick={(la, lo) => pick(la, lo)}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Latitude"
            name="latitude"
            inputMode="decimal"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="e.g. 6.524379"
            error={err.latitude}
          />
          <Field
            label="Longitude"
            name="longitude"
            inputMode="decimal"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="e.g. 3.379206"
            error={err.longitude}
          />
          <Field
            label="Clock-in radius (metres)"
            name="clock_in_radius_m"
            type="number"
            min={25}
            max={5000}
            step={5}
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            error={err.clock_in_radius_m}
          />
        </div>
        <input
          type="range"
          min={25}
          max={1000}
          step={5}
          value={Math.min(radiusNumber, 1000)}
          onChange={(e) => setRadius(e.target.value)}
          aria-label="Clock-in radius"
          className="accent-amber-500"
        />
        {pin ? (
          <button
            type="button"
            onClick={() => {
              setLat('');
              setLng('');
            }}
            className="self-start text-sm text-slate-500 underline"
          >
            Clear location
          </button>
        ) : null}
      </fieldset>

      <Textarea
        label="Emergency instructions"
        name="emergency_instructions"
        rows={5}
        placeholder="Who to call, where the assembly point is, alarm codes procedure…"
        defaultValue={values.emergencyInstructions}
        error={err.emergency_instructions}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold">Site contacts</legend>
        <input type="hidden" name="site_contacts" value={JSON.stringify(contacts)} />
        {contacts.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
            {(['name', 'role', 'phone', 'email'] as const).map((key) => (
              <Field
                key={key}
                label={{ name: 'Name', role: 'Role', phone: 'Phone', email: 'Email' }[key]}
                value={c[key]}
                placeholder={
                  key === 'phone'
                    ? '+2348012345678'
                    : key === 'role'
                      ? 'e.g. Facility manager'
                      : undefined
                }
                onChange={(e) =>
                  setContacts((rows) =>
                    rows.map((row, j) => (j === i ? { ...row, [key]: e.target.value } : row)),
                  )
                }
              />
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setContacts((rows) => rows.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        {err.site_contacts ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            Check the contacts: {err.site_contacts}
          </p>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() =>
            setContacts((rows) => [...rows, { name: '', role: '', phone: '', email: '' }])
          }
        >
          Add contact
        </Button>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={values.active} />
        <span>Active (officers can see and clock in at this site)</span>
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save site' : 'Create site'}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function parseCoord(value: string, limit: number): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

type SearchResult = { display_name: string; lat: string; lon: string };

/**
 * Address lookup with OpenStreetMap's Nominatim (free, no key). Its usage
 * policy allows at most one request per second and no autocomplete, so it only
 * searches when the button is pressed.
 */
function AddressSearch({ onFound }: { onFound: (latitude: number, longitude: number) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
      const response = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      if (!response.ok) throw new Error(`Search failed (${response.status})`);
      setResults((await response.json()) as SearchResult[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter searches instead of submitting the whole site form.
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Search an address or place"
          aria-label="Search an address"
          className="flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-slate-900 dark:border-slate-700 dark:focus:border-slate-200"
        />
        <Button type="button" variant="secondary" onClick={() => void search()} disabled={busy}>
          {busy ? 'Searching…' : 'Find'}
        </Button>
      </div>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {results ? (
        results.length === 0 ? (
          <p className="text-sm text-slate-500">No places found. Try a shorter address.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
            {results.map((r) => (
              <li key={`${r.lat},${r.lon}`}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                  onClick={() => {
                    onFound(roundCoord(Number(r.lat)), roundCoord(Number(r.lon)));
                    setResults(null);
                  }}
                >
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
