-- Accounts for book.remaxhub.ae. Idempotent (ON CONFLICT DO NOTHING); rerun when an advisor is added.
-- Run the first time as soon as migrations have created "users": any existing user switches off
-- /auth/setup, which otherwise lets the first visitor create an ADMIN.
-- No passwords here: people set theirs with "Forgot password". hub-bot never signs in; it only owns
-- the API key Hub Admin uses (ADMIN so it can PATCH any booking's location).
INSERT INTO users (uuid, email, username, name, role, "timeZone", "weekStart", "timeFormat", locale,
                   "emailVerified", "completedOnboarding", "identityProvider", "hideBranding",
                   "brandColor", "darkBrandColor", "creationSource")
VALUES
  (gen_random_uuid(), 'hub-bot@remaxhub.ae',          'hub-bot',         'REMAX Hub (system)', 'ADMIN', 'Asia/Dubai', 'Monday', 24, 'en', now(), true, 'CAL', true, '#003DA5', '#4D7FD1', 'webapp'),
  (gen_random_uuid(), 'yahya.ismail@remaxhub.ae',     'yahya-ismail',    'Yahya Ismail',       'ADMIN', 'Asia/Dubai', 'Monday', 24, 'en', now(), true, 'CAL', true, '#003DA5', '#4D7FD1', 'webapp'),
  (gen_random_uuid(), 'syed.ali@remaxhub.ae',         'syed-ali',        'Syed Ali',           'USER',  'Asia/Dubai', 'Monday', 24, 'en', now(), true, 'CAL', true, '#003DA5', '#4D7FD1', 'webapp'),
  (gen_random_uuid(), 'ayoub.merali@remaxhub.ae',     'ayoub-merali',    'Ayoub Merali',       'USER',  'Asia/Dubai', 'Monday', 24, 'en', now(), true, 'CAL', true, '#003DA5', '#4D7FD1', 'webapp'),
  (gen_random_uuid(), 'akhil.desai@remaxhub.ae',      'akhil-desai',     'Akhil Desai',        'USER',  'Asia/Dubai', 'Monday', 24, 'en', now(), true, 'CAL', true, '#003DA5', '#4D7FD1', 'webapp'),
  (gen_random_uuid(), 'kanchan.madnani@remaxhub.ae',  'kanchan-madnani', 'Kanchan Madnani',    'USER',  'Asia/Dubai', 'Monday', 24, 'en', now(), true, 'CAL', true, '#003DA5', '#4D7FD1', 'webapp'),
  (gen_random_uuid(), 'sunil.rawat@remaxhub.ae',      'sunil-rawat',     'Sunil Rawat',        'USER',  'Asia/Dubai', 'Monday', 24, 'en', now(), true, 'CAL', true, '#003DA5', '#4D7FD1', 'webapp')
ON CONFLICT (email) DO NOTHING;

SELECT id, email, username, role FROM users ORDER BY id;
