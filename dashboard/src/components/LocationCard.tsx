import { useEffect, useState } from "react";
import { devicesApi } from "../api/devices";
import type { LocationPoint } from "../api/types";

/**
 * Reverse-geocodes lat/lng to a "City, District" label via OpenStreetMap's
 * free Nominatim API (no key needed, CORS-enabled). Cached per rounded
 * coordinate (~100m) so nearby/repeated points don't each trigger their own
 * lookup — important since Nominatim's public instance is rate-limited.
 */
const geocodeCache = new Map<string, string>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = cacheKey(lat, lng);
  const cached = geocodeCache.get(key);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`
    );
    const data = await res.json();
    const address = data.address || {};
    const city = address.city || address.town || address.village || address.suburb || null;
    const district = address.state_district || address.county || null;
    const state = address.state || null;
    // Skip the district when it's just the same name as the city
    // (common for India's city-as-district pattern, e.g. "Erode, Erode").
    const secondary = district && district !== city ? district : state;
    const label = [city, secondary].filter(Boolean).join(", ") || "Unknown area";
    geocodeCache.set(key, label);
    return label;
  } catch {
    return "Unknown area";
  }
}

export default function LocationCard({ deviceId, refreshKey }: { deviceId: string; refreshKey?: number }) {
  const [points, setPoints] = useState<LocationPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState<Record<string, string>>({});

  useEffect(() => {
    devicesApi
      .locationHistory(deviceId, 20)
      .then((pts) => {
        setPoints(pts);
        // One geocode lookup per distinct rounded coordinate, not per point.
        const uniqueKeys = new Map<string, { lat: number; lng: number }>();
        pts.forEach((p) => uniqueKeys.set(cacheKey(p.latitude, p.longitude), { lat: p.latitude, lng: p.longitude }));
        uniqueKeys.forEach(({ lat, lng }, key) => {
          reverseGeocode(lat, lng).then((label) => setAreas((prev) => ({ ...prev, [key]: label })));
        });
      })
      .finally(() => setLoading(false));
    // refreshKey isn't read here — it's only in the dependency array so a
    // bump from RemoteActionsCard (after "Check Location Now" acks) triggers
    // a refetch, instead of the list staying stale until the next full page load.
  }, [deviceId, refreshKey]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <h2 className="font-semibold text-sm mb-4">Location History</h2>
      {loading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : points.length === 0 ? (
        <p className="text-xs text-gray-400">
          No location points yet — use "Check Location Now" to request one.
        </p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {points.map((p, i) => {
            const area = areas[cacheKey(p.latitude, p.longitude)];
            return (
              <div key={i} className="flex justify-between items-center text-xs border-b pb-2 last:border-0">
                <div>
                  <div className="font-medium text-gray-700">
                    {area || "Locating area..."}
                    <span className="ml-2 text-gray-400 font-normal">
                      {p.source === "geofence_event" ? "📍 geofence" : "🎯 on-demand"}
                    </span>
                  </div>
                  <div className="text-gray-400 font-mono">
                    {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 whitespace-nowrap">
                    {new Date(p.recorded_at).toLocaleString()}
                  </span>
                  <a
                    href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in Google Maps"
                    className="text-base leading-none hover:opacity-70"
                  >
                    🗺️
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
