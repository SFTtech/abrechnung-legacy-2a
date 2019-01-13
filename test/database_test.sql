-- fill the groups with some example values
insert into users (id, name, email, password) values ('mic', 'michael enßlin', 'michael@ensslin.cc', 'lolnope');
insert into users (id, name, email) values ('jj', 'jonas jelten', 'jj@stusta.net');
insert into groups (name, created_by) values ('sft', 'mic');
insert into groups (name, created_by) values ('mics exclusive group', 'mic');
insert into group_memberships (uid, gid, role) values ('mic', 1, 'admin');
insert into group_memberships (uid, gid, role) values ('jj', 1, 'reader');
insert into group_memberships (uid, gid, role) values ('mic', 2, 'admin');
insert into patches (gid, seq, patch, added_by, notes) values (1, 0, '{lol: 1}', 'mic', 'just a thing');
insert into patches (gid, seq, patch, added_by, notes) values (1, 1, '{lol: 2}', 'mic', 'just a thing');
insert into patches (gid, seq, patch, added_by, notes) values (1, 2, '{lol: 3}', 'mic', 'just a thing');
insert into patches (gid, seq, patch, added_by, notes) values (1, 3, '{lol: 4}', 'mic', 'just a thing');

-- print the tables
select * from users;
select * from groups;
select * from group_memberships;
select * from patches order by (gid, seq) desc;

-- emails of users who have created a group
select distinct email from users, groups where users.id = groups.created_by;
