REVOKE ALL PRIVILEGES ON TABLE "public_vehicle_listings" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "public_vehicle_photos" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE "public_vehicle_availability" FROM anon, authenticated;
GRANT SELECT ON TABLE "public_vehicle_listings" TO anon, authenticated;
GRANT SELECT ON TABLE "public_vehicle_photos" TO anon, authenticated;
GRANT SELECT ON TABLE "public_vehicle_availability" TO anon, authenticated;
