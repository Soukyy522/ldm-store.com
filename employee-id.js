(function(){
    "use strict";

    const KEY = "ldmEmployeesV19";

    function read(){
        try{
            const rows = JSON.parse(localStorage.getItem(KEY) || "[]");
            return Array.isArray(rows) ? rows : [];
        }catch(error){
            return [];
        }
    }

    function write(rows){
        localStorage.setItem(KEY, JSON.stringify(rows));
        return rows;
    }

    function clean(value){
        return String(value || "").trim();
    }

    function usernameKey(value){
        return clean(value).toLowerCase();
    }

    function nextNumber(rows){
        return rows.reduce((max,row) => {
            const match = String(row.employeeId || "").match(/(\d+)$/);
            return Math.max(max, match ? Number(match[1]) : 0);
        }, 0) + 1;
    }

    function createForAccount(input){
        const username = clean(input && input.username);
        if(!username) return null;
        const rows = read();
        const existing = rows.find(row => usernameKey(row.username) === usernameKey(username));
        if(existing){
            existing.active = true;
            existing.role = clean(input && input.role).toLowerCase() || existing.role || "kasir";
            existing.updatedAt = new Date().toISOString();
            write(rows);
            return {...existing};
        }
        const number = nextNumber(rows);
        const employeeId = `LDM-${String(number).padStart(5,"0")}`;
        const employee = {
            employeeId,
            nikKaryawan:employeeId,
            username,
            role:clean(input && input.role).toLowerCase() || "kasir",
            active:true,
            createdAt:new Date().toISOString(),
            updatedAt:new Date().toISOString()
        };
        rows.push(employee);
        write(rows);
        return {...employee};
    }

    function findByUsername(username){
        const found = read().find(row => usernameKey(row.username) === usernameKey(username));
        return found ? {...found} : null;
    }

    function updateUsername(oldUsername,newUsername,role){
        const rows = read();
        const found = rows.find(row => usernameKey(row.username) === usernameKey(oldUsername));
        if(!found) return createForAccount({username:newUsername,role});
        found.username = clean(newUsername);
        found.role = clean(role).toLowerCase() || found.role;
        found.active = true;
        found.updatedAt = new Date().toISOString();
        write(rows);
        return {...found};
    }

    function deactivateByUsername(username){
        const rows = read();
        const found = rows.find(row => usernameKey(row.username) === usernameKey(username));
        if(!found) return false;
        found.active = false;
        found.updatedAt = new Date().toISOString();
        write(rows);
        return true;
    }

    function ensureMigration(){
        const rows = read();
        let accounts = [];
        try{
            const parsed = JSON.parse(localStorage.getItem("daftarAkun") || "[]");
            accounts = Array.isArray(parsed) ? parsed : [];
        }catch(error){
            accounts = [];
        }
        accounts.forEach(account => {
            const username = clean(account && account.username);
            if(!username) return;
            const existing = rows.find(row => usernameKey(row.username) === usernameKey(username));
            if(existing){
                existing.role = clean(account.role).toLowerCase() || existing.role;
                if(account.employeeId) existing.employeeId = clean(account.employeeId);
                if(account.nikKaryawan) existing.nikKaryawan = clean(account.nikKaryawan);
                return;
            }
            const number = nextNumber(rows);
            const employeeId = clean(account.employeeId) || `LDM-${String(number).padStart(5,"0")}`;
            rows.push({
                employeeId,
                nikKaryawan:clean(account.nikKaryawan) || employeeId,
                username,
                role:clean(account.role).toLowerCase() || "kasir",
                active:account.active !== false,
                createdAt:new Date().toISOString(),
                updatedAt:new Date().toISOString()
            });
        });
        write(rows);
        return rows.map(row => ({...row}));
    }

    window.LDMEmployee = Object.freeze({
        version:"19.0.0",read,ensureMigration,createForAccount,
        findByUsername,updateUsername,deactivateByUsername
    });
})();
