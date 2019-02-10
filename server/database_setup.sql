-- kybernetik-abrechnung requires postgres >= 10.5

-- drop owned by abrechnung cascade;

do $$ begin
create type user_role as enum ('admin', 'writer', 'reader', 'banned');
exception
when duplicate_object then null;
end $$;

do $$ begin
create type membership_acceptance as enum ('pending', 'accepted', 'rejected');
exception
when duplicate_object then null;
end $$;

-- used for the  all database tables 
create sequence if not exists last_mod_seq_counter;

-- user list
create table if not exists users (
	id text primary key not null,
	name text not null,
	email text,
	added timestamp not null default current_timestamp,
	added_by text references users (id),
	password_set timestamp default null,
	password_hash text default null,
	email_update_request text default null,
	email_update_request_timestamp timestamp default null,
	email_update_request_token text default null,
	last_mod_seq bigint not null
);

create or replace function users_notify_trigger() returns trigger as $$ declare begin
	perform pg_notify('users', '');
	return NEW;
end; $$ language plpgsql;

drop trigger if exists users_notify_trigger on users;
create trigger users_notify_trigger after insert or update on users execute procedure users_notify_trigger();

create or replace function users_seq_trigger() returns trigger as $$ declare begin
	NEW.last_mod_seq := nextval('last_mod_seq_counter');
	return NEW;
end; $$ language plpgsql;

drop trigger if exists users_seq_trigger on users;
create trigger users_seq_trigger before insert or update on users for each row execute procedure users_seq_trigger();

create index if not exists users_last_mod_seq_index on users (last_mod_seq);

-- user authentication tokens
create table if not exists auth_tokens (
	uid text not null,
	device_id text not null,
	token text not null,
	last_use timestamp not null default current_timestamp,
	primary key (uid, device_id)
);

-- when a user is added, or requests a password reset, he receives a pwreset mail with a token
create table if not exists set_password_tokens (
	uid text primary key not null references users (id),
	token text not null,
	sent timestamp not null default current_timestamp
);

-- group list
create table if not exists groups (
	id serial primary key,
	name text not null,
	created_by text not null references users (id),
	created timestamp not null default current_timestamp,
	last_mod_seq bigint not null
);

create or replace function groups_notify_trigger() returns trigger as $$ declare begin
  perform pg_notify('groups', '');
  return NEW;
end; $$ language plpgsql;

drop trigger if exists groups_notify_trigger on groups;
create trigger groups_notify_trigger after insert or update on groups execute procedure groups_notify_trigger();

create or replace function groups_seq_trigger() returns trigger as $$ declare begin
	NEW.last_mod_seq := nextval('last_mod_seq_counter');
	return NEW;
end; $$ language plpgsql;

drop trigger if exists groups_seq_trigger on groups;
create trigger groups_seq_trigger before insert or update on groups for each row execute procedure groups_seq_trigger();

-- user/group membership
create table if not exists group_memberships (
	uid text references users (id),
	gid integer not null references groups (id),
	added timestamp not null default current_timestamp,
	added_by text not null references users (id),
	role user_role not null,
	acceped membership_acceptance not null default 'pending',
	primary key (uid, gid),
	last_mod_seq bigint not null
);

create index if not exists group_memberships_uid_index on group_memberships (uid);
create index if not exists group_memberships_gid_index on group_memberships (gid);

create or replace function group_memberships_notify_trigger() returns trigger as $$ declare begin
	perform pg_notify('group_memberships', '');
	return NEW;
end; $$ language plpgsql;

drop trigger if exists group_memberships_notify_trigger on group_memberships;
create trigger group_memberships_notify_trigger after insert or update on group_memberships execute procedure group_memberships_notify_trigger();

create or replace function group_memberships_update_seq_trigger() returns trigger as $$
declare
	created_by text;
begin
	NEW.last_mod_seq := nextval('last_mod_seq_counter');
	if NEW.uid = NEW.added_by then
		-- only the founder of a group should be allowed to add himself
		created_by := (select groups.created_by from groups where id = NEW.gid);
		if created_by <> NEW.uid then
			raise sqlstate '23514' using message = 'user invited himself but is not founder of the group';
		end if;
		NEW.accepted = 'accepted';
		NEW.role = 'admin';
	end if;
	return NEW;
end; $$ language plpgsql;

drop trigger if exists group_memberships_update_seq_trigger on group_memberships;
create trigger group_memberships_update_seq_trigger before insert or update on group_memberships for each row execute procedure group_memberships_update_seq_trigger();

-- patches which incrementally create the group objects
create table if not exists patches (
	gid integer,
	seq integer not null, -- the sequence number of the patch in the group.. within one gid, it is unique and unbroken. it starts from 0.
	patch text,
	added_by text,
	notes text,
	created timestamp not null default current_timestamp,
	primary key (gid, seq),
	foreign key (gid) references groups (id),
	foreign key (added_by) references users (id),
	last_mod_seq bigint not null
);

create index if not exists patches_gid_index on patches (gid);
create index if not exists patches_seq_index on patches (seq);

create or replace function patches_notify_trigger() returns trigger as $$ declare begin
  perform pg_notify('patches', '');
  return NEW;
end; $$ language plpgsql;

drop trigger if exists patches_notify_trigger on patches;
create trigger patches_notify_trigger after insert or update on patches execute procedure patches_notify_trigger();

create or replace function patches_seq_trigger() returns trigger as $$ declare begin
	NEW.last_mod_seq := nextval('last_mod_seq_counter');
	return NEW;
end; $$ language plpgsql;

drop trigger if exists patches_seq_trigger on patches;
create trigger patches_seq_trigger after insert or update on patches for each row execute procedure patches_seq_trigger();

create or replace function add_group(name text, created_by text) returns groups as $$
declare
	inserted_group groups%ROWTYPE;
begin
	insert into groups (name, created_by) values (name, created_by) returning * into inserted_group;
	insert into group_memberships (uid, gid, added_by, role, accepted) values (created_by, inserted_group.id, created_by, 'admin', 'accepted');
	return inserted_group;
end; $$ language plpgsql;

create or replace function add_user_to_group(
	uid text,
	gid bigint,
	added_by text,
	role user_role,
	accepted membership_acceptance default 'pending'
)
returns setof group_memberships as $$
#variable_conflict use_variable
declare
	is_admin numeric;
begin
	select into is_admin count(*) from group_memberships as gm where gm.uid = added_by and gm.gid = gid and gm.role = 'admin';
	if is_admin <> 1 then
		return;
	end if;
	return QUERY insert into group_memberships
		(uid, gid, added_by, role, accepted)
		values (uid, gid, added_by, role, accepted)
		on conflict do nothing
		returning *;
end; $$ language plpgsql;
