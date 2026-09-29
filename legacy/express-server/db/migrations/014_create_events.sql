-- Migration: Create events table
-- Admin-managed convention/community event listings for the /events page.
-- date_label is free text (not a real DATE) since these are often ranges
-- ("April 23-26, 2026") or TBA-style values the admin types directly.

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  date_label VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  location VARCHAR(255) NOT NULL,
  link TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_order ON events(is_visible, sort_order);

CREATE TRIGGER update_events_updated_at BEFORE UPDATE
ON events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO events (date_label, title, location, link, sort_order) VALUES
  ('April 4, 2026', 'Rakku-Con Spring', 'Genesis Centre, Calgary, AB', 'https://www.instagram.com/rakkucon/', 0),
  ('April 4, 2026', '@Aidi birthing', 'Greater Vancouver Metro, BC', 'https://www.instagram.com/arguingcrab', 1),
  ('April 23-26, 2026', 'Calgary Expo', 'Stampede Park, Calgary, AB', 'https://downtowncalgary.com/', 2),
  ('June 13, 2026', 'AniYeg', 'Mill Woods Town Centre, Edmonton, AB', 'https://www.onlytogether.tv/aniyeg', 3),
  ('June 16-17, 2026', 'Stephen Avenue Pop Up', 'Stephen Avenue 100 block (in front of Winners), Calgary, AB', 'https://fanexpohq.com/calgaryexpo/', 4),
  ('June 19-21, 2026', 'Game Con', 'Edmonton Expo Centre, Edmonton, AB', 'https://gameconcanada.com/', 5),
  ('June 27-28, 2026', 'Kelowna Comicon', 'MNP Place, Kelowna, BC', 'https://www.kelownacomicon.com/', 6),
  ('July 4-5, 2026', 'Ganbatte Con Canada', 'TCU Place, Saskatoon, SK', 'https://ganbatte.ca/', 7),
  ('July 17-18, 2026', 'Omatsuri (Calgary Japanese Festival)', 'Max Bell Centre, Calgary, AB', 'https://calgaryjca.com/omatsuri/', 8),
  ('July 31 - August 2, 2026', 'AniRevo (Anime Revolution)', 'Vancouver Convention Centre, Vancouver, BC', 'https://summer.animerevolution.ca/', 9),
  ('August 1-3, 2026', 'Heritage Festival (Japan Pavilion)', 'Hawrelak Park, Edmonton, AB', 'https://heritagefest.ca/', 10),
  ('August 7-9, 2026', 'Animethon', 'Edmonton Convention Centre, Edmonton, AB', 'https://animethon.org/', 11),
  ('August 14-15, 2026', 'Karuta Alley Market', 'Calgary, AB', 'https://www.karutaalleymarket.com/', 12),
  ('August 15, 2026', 'Chinatown Street Festival', 'Chinatown, Calgary, AB', 'https://www.calgarychinatown.com/', 13),
  ('September 18-20, 2026', 'Edmonton Expo', 'Edmonton Expo Centre, Edmonton, AB', 'https://fanexpohq.com/edmontonexpo/', 14),
  ('September 26, 2026', 'Rakku-Con Fall', 'Genesis Centre, Calgary, AB', 'https://www.instagram.com/rakkucon/', 15)
ON CONFLICT DO NOTHING;
