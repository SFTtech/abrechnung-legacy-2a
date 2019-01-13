-- kybernetik-abrechnung requires postgres >= 10.5

drop owned by abrechnung cascade;

create type user_role as enum ('admin', 'writer', 'reader', 'banned');

-- used for the  all database tables 
create sequence last_mod_seq_counter;

-- user list
create table users (
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

create function users_notify_trigger_callback() returns trigger as $$ declare begin
	perform pg_notify('users', '');
	return NEW;
end; $$ language plpgsql;
create trigger users_insert_notify_trigger after insert on users execute procedure users_notify_trigger_callback();
create trigger users_update_notify_trigger after update on users execute procedure users_notify_trigger_callback();

create function users_seq_trigger_callback() returns trigger as $$ declare begin
	NEW.last_mod_seq := nextval('last_mod_seq_counter');
	return NEW;
end; $$ language plpgsql;
create trigger users_insert_seq_trigger before insert on users for each row execute procedure users_seq_trigger_callback();
create trigger users_update_seq_trigger before update on users for each row execute procedure users_seq_trigger_callback();

create index users_last_mod_seq_index on users (last_mod_seq);

-- user authentication tokens
create table auth_tokens (
	uid text not null,
	device_id text not null,
	token text not null,
	last_use timestamp not null default current_timestamp,
	primary key (uid, device_id)
);

-- when a user is added, or requests a password reset, he receives a pwreset mail with a token
create table set_password_tokens (
	uid text primary key not null references users (id),
	token text not null,
	sent timestamp not null default current_timestamp
);

-- group list
create table groups (
	id serial primary key,
	name text not null,
	created_by text not null references users (id),
	created timestamp not null default current_timestamp,
	last_mod_seq bigint not null
);

create function groups_notify_trigger_callback() returns trigger as $$ declare begin
  perform pg_notify('groups', '');
  return NEW;
end; $$ language plpgsql;
create trigger groups_insert_notify_trigger after insert on groups execute procedure groups_notify_trigger_callback();
create trigger groups_update_notify_trigger after update on groups execute procedure groups_notify_trigger_callback();

create function groups_seq_trigger_callback() returns trigger as $$ declare begin
	NEW.last_mod_seq := nextval('last_mod_seq_counter');
	return NEW;
end; $$ language plpgsql;
create trigger groups_insert_seq_trigger before insert on groups for each row execute procedure groups_seq_trigger_callback();
create trigger groups_update_seq_trigger before update on groups for each row execute procedure groups_seq_trigger_callback();

-- user/group membership
create table group_memberships (
	uid text references users (id),
	gid integer not null references groups (id),
	added timestamp not null default current_timestamp,
	added_by text not null references users (id),
	role user_role not null,
	primary key (uid, gid),
	last_mod_seq bigint not null
);

create index group_memberships_uid_index on group_memberships (uid);
create index group_memberships_gid_index on group_memberships (gid);

create function group_memberships_notify_trigger_callback() returns trigger as $$ declare begin
  perform pg_notify('group_memberships', '');
  return NEW;
end; $$ language plpgsql;
create trigger group_memberships_insert_notify_trigger after insert on group_memberships execute procedure group_memberships_notify_trigger_callback();
create trigger group_memberships_update_notify_trigger after update on group_memberships execute procedure group_memberships_notify_trigger_callback();

create function group_memberships_seq_trigger_callback() returns trigger as $$ declare begin
	NEW.last_mod_seq := nextval('last_mod_seq_counter');
	return NEW;
end; $$ language plpgsql;
create trigger group_memberships_insert_seq_trigger before insert on group_memberships for each row execute procedure group_memberships_seq_trigger_callback();
create trigger group_memberships_update_seq_trigger before update on group_memberships for each row execute procedure group_memberships_seq_trigger_callback();

-- patches which incrementally create the group objects
create table patches (
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

create index patches_gid_index on patches (gid);
create index patches_seq_index on patches (seq);

create function patches_notify_trigger_callback() returns trigger as $$ declare begin
  perform pg_notify('patches', '');
  return NEW;
end; $$ language plpgsql;
create trigger patches_insert_notify_trigger after insert on patches execute procedure patches_notify_trigger_callback();
create trigger patches_update_notify_trigger after update on patches execute procedure patches_notify_trigger_callback();

create function patches_seq_trigger_callback() returns trigger as $$ declare begin
	NEW.last_mod_seq := nextval('last_mod_seq_counter');
	return NEW;
end; $$ language plpgsql;
create trigger patches_insert_seq_trigger after insert on patches for each row execute procedure patches_seq_trigger_callback();
create trigger patches_update_seq_trigger after update on patches for each row execute procedure patches_seq_trigger_callback();
