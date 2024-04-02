# CosmosRemoteContentMessageConfigurationChangeFeed function

## Purpose
This function indexes the remote content's `message-configuration` by their `userId` into a properly partitioned `user-configurations` collection to avoid cross partition queries during `ListRCConfiguration` operation.

## Trigger
This function is triggered by `change feed` when new records are inserted into the `message-configuration` collection.

## Result
This function inserts new records into `user-configurations` collection, partitioned by `userId` in the form of:
```
{
    userId: "user id"
    id: "configuration id"
}
```
