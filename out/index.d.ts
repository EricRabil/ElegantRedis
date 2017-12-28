import { Document, Model } from "mongoose";
export declare type AsbstractModel = () => (Model<Document> | null);
export declare class CaskContainer {
    private query;
    private model;
    id: string;
    redisID: string;
    /**
     * Used as a fallback for when MongoDB is unavailable to prevent interrupted operation
     */
    private fallbackData;
    /**
     * @param query The query to use when pulling the document from Mongo
     * @param model The observable model object
     * @param logger The logger for this container
     */
    constructor(query: object, model: AsbstractModel);
    /**
     * Fetches a key from the container, first trying redis and then Mongo if it is not cached yet.
     *
     * @param key the key to fetch
     */
    getItem(key: string): Promise<any>;
    /**
     * Delets a key from redis and Mongo
     *
     * @param key the key to delete
     */
    deleteItem(key: string): Promise<void>;
    /**
     * Stores the value with the given key on Redis and Mongo
     * @param key the key to record the value under
     * @param value the data
     */
    setItem(key: string, value: any): Promise<void>;
    /**
     * Stores the given value under the specified key in the redis hash map
     *
     * @param key The key to store this under
     * @param value The value being stored
     */
    private pushToRedis(key, value);
    /**
     * Fetches all sub-keys of the provided key(s) and deletes them
     *
     * @param key the key(s) to recursively delete
     */
    private recursivelyDeleteFromCache(...key);
    /**
     * Deletes the given keys from the redis hashmap
     *
     * @param key The key(s) to delete from Redis
     */
    private deleteFromCache(...key);
    /**
     * Gets the data associated with the given key
     *
     * @param key the key to retrieve
     */
    private getCached(key?);
    /**
     * Gets all keys from the hash map, optionally filtering them
     *
     * @param root the base to filter keys from
     */
    private getRedisKeys(root?);
    /**
     * Gets the value(s) from the hashmap and assembles them into a flattened object
     *
     * @param key The key(s) to pull from the hashmap
     */
    private getFromRedis(key);
    /**
     * Wrapper method for retrieving a key from MongoDB
     *
     * @param key the key to retrieve
     */
    private getMongo(key);
    /**
     * Wrapper method for setting a value in MongoDB
     *
     * @param key the key to record the value under
     * @param value the value to record
     */
    private setMongo(key, value);
    /**
     * Wrapper method for unsetting a value in MongoDB
     *
     * @param key the key to delete
     */
    private deleteMongo(key);
    /**
     * Fetches the MongoDB document, creating and initializing it if necessary.
     */
    private getDocument();
    /**
     * Sets the Redis UUID if it is not set already
     */
    private setRedisID();
}
