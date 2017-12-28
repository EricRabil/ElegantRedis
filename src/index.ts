import * as flat from "flat";
import {Document, Model} from "mongoose";
import * as redisClient from "redis";
import * as uuid from "uuid";

export type AsbstractModel = () => (Model<Document> | null);

let notified: boolean = false;
const redis: redisClient.RedisClient = redisClient.createClient(6379, "localhost").on("ready", () => {
    if ((global as any).redisFailed) {
        console.log("Re-connected to Redis!");
    }
    (global as any).redisFailed = false;
    notified = false;
}).on("error", (err) => {
    if (!notified) {
        console.log(`Error connecting to Redis.`);
        (global as any).redisFailed = true;
        console.log("Containers may exhibit abnormal behavior; queries may be slower as they are always directly interacting with the database.");
        console.log(err.message);
        notified = true;
    }
});

const StorageUtils = {
    ROOT: "storage",
    adapt(key: string): string {
        return this.joinKeys(this.ROOT, key);
    },
    /**
     * Transforms a cached string into a primitive value if applicable
     * @param cachedValue the value to be transforemd
     */
    transform(cachedValue: string): any {
        if (cachedValue.length <= 14) {
            const numberValue = (cachedValue as any) * 1;
            if (!isNaN(numberValue)) {
                return numberValue;
            }
        }
        if (cachedValue === "true") {
            return true;
        }
        if (cachedValue === "false") {
            return false;
        }
        if (cachedValue.startsWith("[") && cachedValue.endsWith("]") || (cachedValue.startsWith("{") && cachedValue.endsWith("}"))) {
            try {
                return JSON.parse(cachedValue);
            } catch (e) {}
        }
        return cachedValue;
    },
    /**
     * Joins the given keys into a resolvable node (for retrieval from Redis and Mongo documents)
     * @param keys the keys to join
     */
    joinKeys(...keys: string[]): string {
        let key: string = "";
        keys.forEach((_key) => {
            if (key.length === 0) {
                key += _key;
            } else {
                key += `.${_key}`;
            }
        });
        return key;
    },
};

export class CaskContainer {

    public id: string;
    public redisID: string;
    /**
     * Used as a fallback for when MongoDB is unavailable to prevent interrupted operation
     */
    private fallbackData: {[key: string]: any} = {};

    /**
     * @param query The query to use when pulling the document from Mongo
     * @param model The observable model object
     * @param logger The logger for this container
     */
    public constructor(private query: object, private model: AsbstractModel) {
    }

    /**
     * Fetches a key from the container, first trying redis and then Mongo if it is not cached yet.
     *
     * @param key the key to fetch
     */
    public async getItem(key: string): Promise<any> {
        await this.setRedisID();
        const cachedItem = await this.getCached(key);
        if (cachedItem) {
            return cachedItem;
        }
        const storedItem = await this.getMongo(key);
        if (typeof storedItem !== "undefined") {
            await this.pushToRedis(key, storedItem);
        }
        return storedItem;
    }

    /**
     * Delets a key from redis and Mongo
     *
     * @param key the key to delete
     */
    public async deleteItem(key: string): Promise<void> {
        await this.setRedisID();
        const deletions: Array<Promise<void>> = [];
        deletions.push(this.recursivelyDeleteFromCache(key));
        deletions.push(this.deleteMongo(key));
        await Promise.all(deletions);
    }

    /**
     * Stores the value with the given key on Redis and Mongo
     * @param key the key to record the value under
     * @param value the data
     */
    public async setItem(key: string, value: any): Promise<void> {
        await this.setRedisID();
        await this.recursivelyDeleteFromCache(key);
        const updates: Array<Promise<void>> = [];
        updates.push(this.pushToRedis(key, value));
        updates.push(this.setMongo(key, value));
        await Promise.all(updates);
    }

    /**
     * Stores the given value under the specified key in the redis hash map
     *
     * @param key The key to store this under
     * @param value The value being stored
     */
    private pushToRedis(key: string, value: any): Promise<void> {
        return new Promise((resolve, reject) => {
            if ((global as any).redisFailed) {
                return;
            }
            value = {
                [key]: value,
            };
            value = flat(value, {safe: true});
            const hmSets: string[] = [];
            const hDel: string[] = [];
            Object.keys(value).forEach((objectKey) => {
                if (value[objectKey] === null || value[objectKey] === undefined) {
                    hDel.push(objectKey);
                    return;
                }
                if (Array.isArray(value[objectKey])) {
                    value[objectKey] = JSON.stringify(value[objectKey]);
                } else if (typeof value[objectKey] === "object") {
                    value[objectKey] = JSON.stringify(value[objectKey]);
                }
                // Pushes to the string array the key, then value. This simulates HMSET (key) field1 value1
                hmSets.push(objectKey);
                hmSets.push(value[objectKey]);
            });
            // Spreads the hmSets array for infinite arguments
            redis.hmset(this.redisID, ...hmSets, (err) => {
                if (err) {
                    reject(err);
                } else {
                    if (hDel.length >= 1) {
                        this.deleteFromCache(...hDel).then(() => resolve());
                    } else {
                        resolve();
                    }
                }
            });
        });
    }

    /**
     * Fetches all sub-keys of the provided key(s) and deletes them
     *
     * @param key the key(s) to recursively delete
     */
    private recursivelyDeleteFromCache(...key: string[]): Promise<void> {
        return new Promise((resolve) => {
            if ((global as any).redisFailed) {
                resolve();
                return;
            }
            const keys: string[] = [];
            const lookups: Promise<string[][]> = Promise.all(key.map((_key) => this.getRedisKeys(_key)));
            lookups.then((fetchedKeys) => {
                fetchedKeys.forEach((deleteKeys) => keys.push(...deleteKeys));
                this.deleteFromCache(...keys).then(() => {
                    resolve();
                });
            });
        });
    }

    /**
     * Deletes the given keys from the redis hashmap
     *
     * @param key The key(s) to delete from Redis
     */
    private deleteFromCache(...key: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            if ((global as any).redisFailed) {
                resolve();
                return;
            }
            if (key.length === 0) {
                resolve();
                return;
            }
            redis.hdel(this.redisID, ...key, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Gets the data associated with the given key
     *
     * @param key the key to retrieve
     */
    private async getCached(key?: string): Promise<any> {
        if ((global as any).redisFailed) {
            return undefined;
        }
        const keys = await this.getRedisKeys(key);
        // A flattened object pulled straight from redis
        const result = await this.getFromRedis(keys);
        if (!result) {
            return undefined;
        }

        const resultKeys = Object.keys(result);

        // Parses the values if they are primitives
        resultKeys.forEach((resultKey) => {
            result[resultKey] = StorageUtils.transform(result[resultKey]);
        });

        if (resultKeys.length === 1) {
            if (resultKeys[0] === key) {
                return result[resultKeys[0]];
            }
        }
        return flat.unflatten(result);
    }

    /**
     * Gets all keys from the hash map, optionally filtering them
     *
     * @param root the base to filter keys from
     */
    private getRedisKeys(root?: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            if ((global as any).redisFailed) {
                resolve([]);
                return;
            }
            redis.hkeys(this.redisID, (err, keys) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (!root) {
                    resolve(keys);
                    return;
                }
                resolve(keys.filter((key) => key.startsWith(root)));
            });
        });
    }

    /**
     * Gets the value(s) from the hashmap and assembles them into a flattened object
     *
     * @param key The key(s) to pull from the hashmap
     */
    private getFromRedis(key: string | string[]): Promise<{[key: string]: string} | undefined> {
        return new Promise((resolve) => {
            if ((global as any).redisFailed) {
                resolve(undefined);
                return;
            }
            redis.hmget(this.redisID, key, (err, res) => {
                if (err) {
                    resolve(undefined);
                    return;
                }
                const result: {[key: string]: any} = {};
                if (Array.isArray(key)) {
                    key.forEach((_key, index) => {
                        result[_key] = res[index];
                    });
                } else {
                    result[key] = res[0];
                }
                resolve(result);
            });
        });
    }

    /**
     * Wrapper method for retrieving a key from MongoDB
     *
     * @param key the key to retrieve
     */
    private async getMongo(key: string): Promise<any> {
        const document = await this.getDocument();
        if (document) {
            return document.get(StorageUtils.adapt(key));
        }
        return this.fallbackData[key];
    }

    /**
     * Wrapper method for setting a value in MongoDB
     *
     * @param key the key to record the value under
     * @param value the value to record
     */
    private async setMongo(key: string, value: any): Promise<void> {
        const document = await this.getDocument();
        if (document) {
            document.set(StorageUtils.adapt(key), value);
            document.markModified(StorageUtils.adapt(key));
            await document.save();
            return;
        }
        this.fallbackData[key] = value;
    }

    /**
     * Wrapper method for unsetting a value in MongoDB
     *
     * @param key the key to delete
     */
    private async deleteMongo(key: string): Promise<void> {
        const document = await this.getDocument();
        if (document) {
            document.set(StorageUtils.adapt(key), undefined);
            document.markModified(StorageUtils.adapt(key));
            await document.save();
            return;
        }
        delete this.fallbackData[key];
    }

    /**
     * Fetches the MongoDB document, creating and initializing it if necessary.
     */
    private async getDocument(): Promise<Document | undefined> {
        const model = this.model();
        if (model) {
            let document = await model.findOne(this.query);
            let changes: boolean = false;
            if (!document) {
                document = new model(this.query);
                changes = true;
            }
            if (!document.get(StorageUtils.ROOT)) {
                document.set(StorageUtils.ROOT, {});
                changes = true;
            }
            if (changes) {
                await document.save();
            }
            return document;
        }
        return undefined;
    }

    /**
     * Sets the Redis UUID if it is not set already
     */
    private async setRedisID(): Promise<void> {
        if (!!this.redisID) {
            return;
        }
        const document = await this.getDocument();
        if (document) {
            this.redisID = `${StorageUtils.ROOT}.${document._id}`;
        } else {
            this.redisID = `${StorageUtils.ROOT}.${uuid.v4()}`;
        }
    }
}
