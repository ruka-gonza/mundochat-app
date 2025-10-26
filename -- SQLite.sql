-- SQLite
DELETE FROM room_staff WHERE userId = (SELECT id FROM users WHERE lower(nick) = 'kano');
