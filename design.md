# kybernetik-abrechnung design

## Basic design

Core concepts

- Each party in the Abrechnung has a user account.
- For each group of events, there is a group.
- Groups have a set of users who are members.
- Users can only see data from groups they are a member of.
- Groups don't influence each other.
- Each group's data is one JSON object (the "group object")
- The database stores a list of JSONDiffPatch patches for each group.
- `evaluate_group()` calculates each group member's balance from the JSON object.

For the SQL database architecture, see `design.sql`.
For an example group object, see `design.json`.

## Main design elements

- SQL data structure
- Data transport (Database to Server to Client to Server to Database)
- `evaluate_group()` function
- Pretty client-side GUI for editing the group object and parts of it

## Datenschutz

- group membership: member as soon as invited. can see other user names and group object as soon as invited and who is sharing their data.
- can accept to share data: can see other user's data and other users can see your data then.
