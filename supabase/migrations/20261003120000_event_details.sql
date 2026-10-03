-- Events get a venue and a "learn more" link, and the real 2026 list is loaded once.
alter table public.store_events add column if not exists venue text;
alter table public.store_events add column if not exists link_url text;

-- The convention schedule, in date order. Only when no events exist yet, so anything staff
-- already entered in the admin is left alone; after this the Events screen is the source of truth.
insert into public.store_events (name, venue, city, start_date, end_date, link_url, sort_order)
select e.name, e.venue, e.city, e.start_date::date, e.end_date::date, e.link_url, e.ord
  from (values
    ('Rakku-Con Spring',                    'Genesis Centre',                                 'Calgary, AB',   '2026-04-04', null,         'https://www.instagram.com/rakkucon/',               0),
    ('Calgary Expo',                        'Stampede Park',                                  'Calgary, AB',   '2026-04-23', '2026-04-26', 'https://fanexpohq.com/calgaryexpo/',                1),
    ('AniYeg',                              'Mill Woods Town Centre',                         'Edmonton, AB',  '2026-06-13', null,         'https://www.onlytogether.tv/aniyeg',                2),
    ('Stephen Avenue Pop Up',               'Stephen Avenue 100 block (in front of Winners)', 'Calgary, AB',   '2026-06-16', '2026-06-17', 'https://downtowncalgary.com/',                      3),
    ('Game Con',                            'Edmonton Expo Centre',                           'Edmonton, AB',  '2026-06-19', '2026-06-21', 'https://gameconcanada.com/',                        4),
    ('Kelowna Comicon',                     'MNP Place',                                      'Kelowna, BC',   '2026-06-27', '2026-06-28', 'https://www.kelownacomicon.com/',                   5),
    ('Ganbatte Con Canada',                 'TCU Place',                                      'Saskatoon, SK', '2026-07-04', '2026-07-05', 'https://ganbatte.ca/',                              6),
    ('Omatsuri (Calgary Japanese Festival)','Max Bell Centre',                                'Calgary, AB',   '2026-07-17', '2026-07-18', 'https://calgaryjca.com/omatsuri/',                  7),
    ('AniRevo (Anime Revolution)',          'Vancouver Convention Centre',                    'Vancouver, BC', '2026-07-31', '2026-08-02', 'https://summer.animerevolution.ca/',                8),
    ('Heritage Festival (Japan Pavilion)',  'Hawrelak Park',                                  'Edmonton, AB',  '2026-08-01', '2026-08-03', 'https://heritagefest.ca/',                          9),
    ('Animethon',                           'Edmonton Convention Centre',                     'Edmonton, AB',  '2026-08-07', '2026-08-09', 'https://animethon.org/',                           10),
    ('Karuta Alley Market',                 null,                                             'Calgary, AB',   '2026-08-14', '2026-08-15', 'https://www.karutaalleymarket.com/',               11),
    ('Chinatown Street Festival',           'Chinatown',                                      'Calgary, AB',   '2026-08-15', null,         'https://www.calgarychinatown.com/',                12),
    ('Edmonton Expo',                       'Edmonton Expo Centre',                           'Edmonton, AB',  '2026-09-18', '2026-09-20', 'https://fanexpohq.com/edmontonexpo/',              13),
    ('Rakku-Con Fall',                      'Genesis Centre',                                 'Calgary, AB',   '2026-09-26', null,         'https://www.instagram.com/rakkucon/',              14)
  ) as e(name, venue, city, start_date, end_date, link_url, ord)
 where not exists (select 1 from public.store_events);
