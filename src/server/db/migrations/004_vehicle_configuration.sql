ALTER TABLE player_vehicles ADD COLUMN paint_id TEXT;
ALTER TABLE player_vehicles ADD COLUMN paint_finish TEXT NOT NULL DEFAULT 'gloss';

UPDATE player_vehicles SET paint_id = CASE model_id
  WHEN 'modern-sedan' THEN 'atlantic-blue'
  WHEN 'modern-suv' THEN 'farmington-sage'
  WHEN 'city-hatchback' THEN 'duala-teal'
  WHEN 'taxi-sedan' THEN 'cooperative-gold'
  WHEN 'city-minibus' THEN 'savannah-cream'
  ELSE 'cooperative-gold'
END
WHERE paint_id IS NULL;
