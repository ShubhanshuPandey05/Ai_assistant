class UserStorage {
    constructor() {
        this.users = [];
    }

    static createUser(userData) {
        return {
            Name: userData.Name || '',
            UserId: userData.UserId || '',
            Phone: userData.Phone || '',
            PastSessionId: userData.PastSessionId || [],
            ActiveSessionId: userData.ActiveSessionId || '',
            Email: userData.Email || ''
        };
    }

    addUser(userData) {
        const user = UserStorage.createUser(userData);
        if (this.findUser(user.UserId) || this.findUser(user.Phone) || this.findUser(user.Email)) {
            throw new Error('User already exists with this UserId, Phone, or Email');
        }
        this.users.push(user);
        return user;
    }

    findUser(searchValue) {
        if (!searchValue) return null;
        return this.users.find(user => {
            return user.Name === searchValue ||
                user.UserId === searchValue ||
                user.Phone === searchValue ||
                user.Email === searchValue ||
                user.ActiveSessionId === searchValue ||
                (Array.isArray(user.PastSessionId) && user.PastSessionId.includes(searchValue));
        });
    }

    findUsers(searchValue) {
        if (!searchValue) return [];
        return this.users.filter(user => {
            return user.Name === searchValue ||
                user.UserId === searchValue ||
                user.Phone === searchValue ||
                user.Email === searchValue ||
                user.ActiveSessionId === searchValue ||
                (Array.isArray(user.PastSessionId) && user.PastSessionId.includes(searchValue));
        });
    }

    searchUsers(searchTerm) {
        if (!searchTerm) return [];
        const term = searchTerm.toLowerCase();
        return this.users.filter(user => {
            return user.Name.toLowerCase().includes(term) ||
                user.UserId.toLowerCase().includes(term) ||
                user.Phone.includes(term) ||
                user.Email.toLowerCase().includes(term) ||
                user.ActiveSessionId.toLowerCase().includes(term);
        });
    }

    updateUser(identifier, updates) {
        const user = this.findUser(identifier);
        if (!user) {
            throw new Error('User not found');
        }
        Object.keys(updates).forEach(key => {
            if (user.hasOwnProperty(key)) {
                user[key] = updates[key];
            }
        });
        return user;
    }

    deleteUser(identifier) {
        const index = this.users.findIndex(user => {
            return user.Name === identifier ||
                user.UserId === identifier ||
                user.Phone === identifier ||
                user.Email === identifier ||
                user.ActiveSessionId === identifier ||
                (Array.isArray(user.PastSessionId) && user.PastSessionId.includes(identifier));
        });
        if (index === -1) {
            throw new Error('User not found');
        }
        return this.users.splice(index, 1)[0];
    }

    getAllUsers() {
        return [...this.users];
    }

    toJSON() {
        return JSON.stringify(this.users, null, 2);
    }

    fromJSON(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            this.users = data.map(userData => UserStorage.createUser(userData));
            return this.users;
        } catch (error) {
            throw new Error('Invalid JSON format');
        }
    }

    loadFromData(data) {
        if (Array.isArray(data)) {
            this.users = data.map(userData => UserStorage.createUser(userData));
        } else {
            throw new Error('Data must be an array of user objects');
        }
        return this.users;
    }

    addPastSession(identifier, sessionId) {
        const user = this.findUser(identifier);
        if (!user) {
            throw new Error('User not found');
        }
        if (!Array.isArray(user.PastSessionId)) {
            user.PastSessionId = [];
        }
        if (!user.PastSessionId.includes(sessionId)) {
            user.PastSessionId.push(sessionId);
        }
        return user;
    }

    setActiveSession(identifier, newSessionId) {
        const user = this.findUser(identifier);
        if (!user) {
            throw new Error('User not found');
        }
        if (user.ActiveSessionId) {
            this.addPastSession(identifier, user.ActiveSessionId);
        }
        user.ActiveSessionId = newSessionId;
        return user;
    }

    getUserCount() {
        return this.users.length;
    }
}

module.exports = {
    UserStorage,
    userStorage: new UserStorage(),
};



