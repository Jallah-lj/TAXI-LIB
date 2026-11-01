-- Preserve replay compatibility for purchases recorded before appearance
-- configuration became part of the request fingerprint.
UPDATE lifestyle_requests
SET target = target || ':' || CASE target
  WHEN 'modern-sedan' THEN 'atlantic-blue'
  WHEN 'modern-suv' THEN 'farmington-sage'
  WHEN 'city-hatchback' THEN 'duala-teal'
  WHEN 'starter-sedan' THEN 'kendeja-gold'
  WHEN 'city-minibus' THEN 'pearl'
  ELSE 'atlantic-blue'
END || ':gloss'
WHERE kind = 'vehicle.purchase' AND instr(target, ':') = 0;
