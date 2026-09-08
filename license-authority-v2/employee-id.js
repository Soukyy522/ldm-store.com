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

    function currentStoreId(input){
        return clean(input && input.storeId)
            || clean(localStorage.getItem("ldmCloudStoreId"))
            || clean(localStorage.getItem("currentStoreId"))
            || clean(localStorage.getItem("storeId"))
            || "LOCAL-DEFAULT";
    }

    function isEmployeeNik(value){
        return /^\d{11}$/.test(clean(value));
    }

    function nextNumber(rows,storeId){
        const targetStore=currentStoreId({storeId});
        return rows.reduce((max,row) => {
            const rowStore=currentStoreId({storeId:row.storeId||targetStore});
            if(rowStore!==targetStore || !isEmployeeNik(row.employeeId)) return max;
            return Math.max(max,Number(String(row.employeeId).slice(-3))||0);
        },0)+1;
    }

    function buildEmployeeNik(createdAt,number){
        if(number>999) throw new Error("Batas 999 NIK Karyawan pada Store ID ini telah tercapai.");
        const date=new Date(createdAt||Date.now());
        const safeDate=Number.isFinite(date.getTime())?date:new Date();
        const pad=value=>String(value).padStart(2,"0");
        return String(safeDate.getFullYear()).slice(-2)
            +pad(safeDate.getMonth()+1)
            +pad(safeDate.getDate())
            +pad(safeDate.getSeconds())
            +String(number).padStart(3,"0");
    }

    function createForAccount(input){
        const username = clean(input && input.username);
        if(!username) return null;
        const rows = read();
        const storeId=currentStoreId(input);
        const existing = rows.find(row => usernameKey(row.username) === usernameKey(username));
        if(existing){
            if(!isEmployeeNik(existing.employeeId)){
                existing.employeeId=buildEmployeeNik(
                    existing.createdAt||input.createdAt,
                    nextNumber(rows,storeId)
                );
                existing.nikKaryawan=existing.employeeId;
            }
            existing.active = true;
            existing.role = clean(input && input.role).toLowerCase() || existing.role || "kasir";
            existing.storeId=storeId;
            existing.updatedAt = new Date().toISOString();
            write(rows);
            return {...existing};
        }
        const requestedDate=new Date(input&&input.createdAt||Date.now());
        const createdAt=(Number.isFinite(requestedDate.getTime())?requestedDate:new Date()).toISOString();
        const number = nextNumber(rows,storeId);
        const employeeId = buildEmployeeNik(createdAt,number);
        const employee = {
            employeeId,
            nikKaryawan:employeeId,
            username,
            role:clean(input && input.role).toLowerCase() || "kasir",
            storeId,
            active:true,
            createdAt,
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
        const defaultStoreId=currentStoreId();
        let accounts = [];
        try{
            const parsed = JSON.parse(localStorage.getItem("daftarAkun") || "[]");
            accounts = Array.isArray(parsed) ? parsed : [];
        }catch(error){
            accounts = [];
        }

        rows
            .sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0))
            .forEach(row=>{
                const storeId=currentStoreId({storeId:row.storeId||defaultStoreId});
                row.storeId=storeId;
                if(!isEmployeeNik(row.employeeId)){
                    row.employeeId=buildEmployeeNik(
                        row.createdAt,
                        nextNumber(rows,storeId)
                    );
                }
                row.nikKaryawan=row.employeeId;
            });

        accounts.forEach(account => {
            const username = clean(account && account.username);
            if(!username) return;
            const storeId=currentStoreId({storeId:account.storeId||defaultStoreId});
            const existing = rows.find(row => usernameKey(row.username) === usernameKey(username));
            if(existing){
                existing.role = clean(account.role).toLowerCase() || existing.role;
                existing.storeId=storeId;
                return;
            }
            const createdAt=account.createdAt||account.created_at||new Date().toISOString();
            const number = nextNumber(rows,storeId);
            const employeeId = isEmployeeNik(account.employeeId||account.nikKaryawan)
                ? clean(account.employeeId||account.nikKaryawan)
                : buildEmployeeNik(createdAt,number);
            rows.push({
                employeeId,
                nikKaryawan:employeeId,
                username,
                role:clean(account.role).toLowerCase() || "kasir",
                storeId,
                active:account.active !== false,
                createdAt,
                updatedAt:new Date().toISOString()
            });
        });
        write(rows);
        return rows.map(row => ({...row}));
    }

    window.LDMEmployee = Object.freeze({
        version:"27.0.0",read,ensureMigration,createForAccount,
        findByUsername,updateUsername,deactivateByUsername
    });
})();
