-- =============================================================================
-- LocDailyMar 26.0 - KATALOG BARANG PUSAT + SINKRONISASI CABANG
--
-- Tujuan:
--   1. Nama/barcode/kategori/satuan/harga beli/harga jual/promo berasal dari
--      cabang pusat dan dapat disinkronkan ke seluruh cabang.
--   2. Stok dan tanggal kedaluwarsa TIDAK ikut disalin. Nilainya tetap per toko.
--   3. Hanya Owner Utama pada cabang pusat yang dapat mengubah katalog.
--   4. Goods Receipt cabang tetap boleh menambah stok, tetapi tidak boleh
--      mengganti harga beli master cabang.
--
-- Prasyarat: SQL Tahap 22, 25, 25.2, 25.3, dan 25.3.1 sudah terpasang.
-- Jalankan sekali di Supabase Dashboard > SQL Editor project APLIKASI.
-- =============================================================================

begin;

do $$
begin
    if to_regclass('public.products') is null then
        raise exception 'Tabel public.products belum tersedia.';
    end if;
    if to_regclass('public.store_networks') is null
       or to_regclass('public.store_network_stores') is null then
        raise exception 'Tahap Multi Toko belum terpasang.';
    end if;
    if to_regprocedure('public.ldm_is_primary_owner()') is null then
        raise exception 'Tahap Owner Utama belum terpasang.';
    end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Status sinkron per cabang dan pemetaan UUID produk pusat -> produk cabang.
-- Pemetaan diperlukan agar produk tanpa barcode tetap mempunyai pasangan stabil.
-- -----------------------------------------------------------------------------
create table if not exists public.product_catalog_sync_settings (
    network_id uuid not null references public.store_networks(id) on delete cascade,
    store_id uuid not null references public.stores(id) on delete cascade,
    enabled boolean not null default false,
    last_synced_at timestamptz,
    last_synced_by uuid references auth.users(id) on delete set null,
    last_result jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (network_id,store_id),
    unique (store_id)
);

create table if not exists public.product_catalog_links (
    network_id uuid not null references public.store_networks(id) on delete cascade,
    primary_product_id uuid not null references public.products(id) on delete cascade,
    branch_store_id uuid not null references public.stores(id) on delete cascade,
    branch_product_id uuid not null references public.products(id) on delete cascade,
    last_synced_at timestamptz not null default now(),
    primary key (network_id,primary_product_id,branch_store_id),
    unique (branch_store_id,branch_product_id)
);

create index if not exists product_catalog_links_branch_idx
on public.product_catalog_links(branch_store_id,last_synced_at desc);

alter table public.product_catalog_sync_settings enable row level security;
alter table public.product_catalog_links enable row level security;

revoke all on public.product_catalog_sync_settings,public.product_catalog_links
from public,anon,authenticated;

drop policy if exists product_catalog_sync_settings_primary_read
on public.product_catalog_sync_settings;
create policy product_catalog_sync_settings_primary_read
on public.product_catalog_sync_settings
for select to authenticated
using (public.ldm_is_primary_owner());

drop policy if exists product_catalog_links_primary_read
on public.product_catalog_links;
create policy product_catalog_links_primary_read
on public.product_catalog_links
for select to authenticated
using (public.ldm_is_primary_owner());

grant select on public.product_catalog_sync_settings,public.product_catalog_links
to authenticated;

-- -----------------------------------------------------------------------------
-- Owner Utama hanya boleh mengedit katalog saat toko aktifnya adalah toko pusat.
-- -----------------------------------------------------------------------------
create or replace function public.ldm_can_manage_central_catalog()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
    select public.ldm_is_primary_owner()
       and exists(
            select 1
            from public.store_networks n
            join public.store_network_stores sns
              on sns.network_id=n.id
             and sns.is_primary=true
             and sns.active=true
            where n.primary_owner_user_id=auth.uid()
              and n.active=true
              and n.deleted_at is null
              and sns.store_id=public.ldm_current_store_id()
       );
$$;

-- -----------------------------------------------------------------------------
-- Pengaman tingkat database.
-- Operasi stok biasa tetap diizinkan. Bila Goods Receipt cabang mencoba mengubah
-- purchase_price bersamaan dengan stok, harga master dikembalikan ke nilai lama.
-- -----------------------------------------------------------------------------
create or replace function public.ldm_guard_central_product_catalog()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
    v_internal boolean := coalesce(current_setting('ldm.catalog_sync_internal',true),'')='on';
    v_other_catalog_changed boolean := false;
begin
    if auth.uid() is null or v_internal or public.ldm_can_manage_central_catalog() then
        if tg_op='DELETE' then return old; end if;
        return new;
    end if;

    if tg_op='INSERT' then
        raise exception 'KATALOG_PUSAT_TERKUNCI: hanya Owner Utama pada cabang pusat yang dapat menambah barang.';
    elsif tg_op='DELETE' then
        raise exception 'KATALOG_PUSAT_TERKUNCI: hanya Owner Utama pada cabang pusat yang dapat menghapus barang.';
    end if;

    v_other_catalog_changed :=
        old.barcode is distinct from new.barcode
        or old.name is distinct from new.name
        or old.category is distinct from new.category
        or old.unit is distinct from new.unit
        or old.purchase_unit is distinct from new.purchase_unit
        or old.purchase_unit_factor is distinct from new.purchase_unit_factor
        or old.sale_price is distinct from new.sale_price
        or old.promo_active is distinct from new.promo_active
        or old.promo_name is distinct from new.promo_name
        or old.promo_type is distinct from new.promo_type
        or old.promo_value is distinct from new.promo_value
        or old.promo_price is distinct from new.promo_price
        or old.promo_min_qty is distinct from new.promo_min_qty
        or old.promo_start_date is distinct from new.promo_start_date
        or old.promo_end_date is distinct from new.promo_end_date
        or old.active is distinct from new.active
        or old.deleted_at is distinct from new.deleted_at;

    if v_other_catalog_changed then
        raise exception 'KATALOG_PUSAT_TERKUNCI: data barang dan harga dikelola Owner Utama pada cabang pusat.';
    end if;

    -- GR/operasi persediaan cabang tetap berjalan, tetapi tidak mengganti HPP master.
    if old.purchase_price is distinct from new.purchase_price then
        new.purchase_price := old.purchase_price;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_stage26_central_catalog_guard on public.products;
create trigger trg_stage26_central_catalog_guard
before insert or update or delete on public.products
for each row execute function public.ldm_guard_central_product_catalog();

-- Browser tidak memperoleh hak mutasi tabel secara langsung.
revoke insert,update,delete on public.products from authenticated;

-- -----------------------------------------------------------------------------
-- Sinkron satu produk. Fungsi internal ini sengaja tidak diberikan ke browser.
-- -----------------------------------------------------------------------------
create or replace function public.ldm_sync_catalog_product_internal(
    p_network_id uuid,
    p_primary_store_id uuid,
    p_branch_store_id uuid,
    p_primary_product_id uuid
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
    v_source public.products%rowtype;
    v_branch_product_id uuid;
    v_result text := 'updated';
begin
    if p_primary_store_id=p_branch_store_id then return 'skipped_primary'; end if;

    select p.* into v_source
    from public.products p
    where p.id=p_primary_product_id
      and p.store_id=p_primary_store_id;

    select l.branch_product_id into v_branch_product_id
    from public.product_catalog_links l
    where l.network_id=p_network_id
      and l.primary_product_id=p_primary_product_id
      and l.branch_store_id=p_branch_store_id;

    perform set_config('ldm.catalog_sync_internal','on',true);

    if v_source.id is null or v_source.deleted_at is not null then
        if v_branch_product_id is not null then
            update public.products
               set active=false,
                   deleted_at=coalesce(deleted_at,now()),
                   deleted_by=auth.uid()
             where id=v_branch_product_id
               and store_id=p_branch_store_id;
            perform set_config('ldm.catalog_sync_internal','off',true);
            return 'archived';
        end if;
        perform set_config('ldm.catalog_sync_internal','off',true);
        return 'skipped_missing';
    end if;

    if v_branch_product_id is null and nullif(btrim(coalesce(v_source.barcode,'')),'') is not null then
        select p.id into v_branch_product_id
        from public.products p
        where p.store_id=p_branch_store_id
          and p.barcode=v_source.barcode
          and p.deleted_at is null
          and not exists(
              select 1 from public.product_catalog_links l
              where l.branch_store_id=p_branch_store_id
                and l.branch_product_id=p.id
          )
        limit 1;
    end if;

    if v_branch_product_id is null and nullif(btrim(v_source.barcode),'') is null then
        select candidate.id into v_branch_product_id
        from (
            select p.id,count(*) over() as total
            from public.products p
            where p.store_id=p_branch_store_id
              and lower(p.name)=lower(v_source.name)
              and p.deleted_at is null
              and not exists(
                  select 1 from public.product_catalog_links l
                  where l.branch_store_id=p_branch_store_id
                    and l.branch_product_id=p.id
              )
        ) candidate
        where candidate.total=1
        limit 1;
    end if;

    if v_branch_product_id is null then
        insert into public.products(
            store_id,barcode,name,category,unit,purchase_unit,purchase_unit_factor,
            purchase_price,sale_price,legacy_stock_snapshot,last_expiry_date,
            promo_active,promo_name,promo_type,promo_value,promo_price,promo_min_qty,
            promo_start_date,promo_end_date,active
        ) values (
            p_branch_store_id,v_source.barcode,v_source.name,v_source.category,
            v_source.unit,v_source.purchase_unit,v_source.purchase_unit_factor,
            v_source.purchase_price,v_source.sale_price,0,null,
            v_source.promo_active,v_source.promo_name,v_source.promo_type,
            v_source.promo_value,v_source.promo_price,v_source.promo_min_qty,
            v_source.promo_start_date,v_source.promo_end_date,v_source.active
        ) returning id into v_branch_product_id;
        v_result := 'inserted';
    else
        update public.products
           set barcode=v_source.barcode,
               name=v_source.name,
               category=v_source.category,
               unit=v_source.unit,
               purchase_unit=v_source.purchase_unit,
               purchase_unit_factor=v_source.purchase_unit_factor,
               purchase_price=v_source.purchase_price,
               sale_price=v_source.sale_price,
               promo_active=v_source.promo_active,
               promo_name=v_source.promo_name,
               promo_type=v_source.promo_type,
               promo_value=v_source.promo_value,
               promo_price=v_source.promo_price,
               promo_min_qty=v_source.promo_min_qty,
               promo_start_date=v_source.promo_start_date,
               promo_end_date=v_source.promo_end_date,
               active=v_source.active,
               deleted_at=null,
               deleted_by=null
         where id=v_branch_product_id
           and store_id=p_branch_store_id;
    end if;

    insert into public.product_catalog_links(
        network_id,primary_product_id,branch_store_id,branch_product_id,last_synced_at
    ) values (
        p_network_id,p_primary_product_id,p_branch_store_id,v_branch_product_id,now()
    )
    on conflict(network_id,primary_product_id,branch_store_id) do update
       set branch_product_id=excluded.branch_product_id,
           last_synced_at=now();

    perform set_config('ldm.catalog_sync_internal','off',true);
    return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sinkron penuh satu cabang. Stok/expiry pada cabang tidak pernah ditimpa.
-- -----------------------------------------------------------------------------
create or replace function public.ldm_sync_catalog_store_internal(
    p_network_id uuid,
    p_primary_store_id uuid,
    p_branch_store_id uuid,
    p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_product record;
    v_state text;
    v_inserted integer := 0;
    v_updated integer := 0;
    v_archived integer := 0;
    v_total integer := 0;
    v_result jsonb;
begin
    if not exists(
        select 1 from public.store_network_stores sns
        where sns.network_id=p_network_id
          and sns.store_id=p_primary_store_id
          and sns.is_primary=true and sns.active=true
    ) then raise exception 'STORE_PUSAT_TIDAK_VALID'; end if;

    if not exists(
        select 1 from public.store_network_stores sns
        where sns.network_id=p_network_id
          and sns.store_id=p_branch_store_id
          and sns.is_primary=false and sns.active=true
    ) then raise exception 'CABANG_TUJUAN_TIDAK_VALID'; end if;

    for v_product in
        select p.id from public.products p
        where p.store_id=p_primary_store_id
        order by p.created_at,p.id
    loop
        v_state := public.ldm_sync_catalog_product_internal(
            p_network_id,p_primary_store_id,p_branch_store_id,v_product.id
        );
        v_total := v_total + 1;
        if v_state='inserted' then v_inserted:=v_inserted+1;
        elsif v_state='archived' then v_archived:=v_archived+1;
        elsif v_state='updated' then v_updated:=v_updated+1;
        end if;
    end loop;

    v_result := jsonb_build_object(
        'store_id',p_branch_store_id,
        'processed',v_total,
        'inserted',v_inserted,
        'updated',v_updated,
        'archived',v_archived,
        'synced_at',now()
    );

    insert into public.product_catalog_sync_settings(
        network_id,store_id,last_synced_at,last_synced_by,last_result,updated_at
    ) values (
        p_network_id,p_branch_store_id,now(),p_actor,v_result,now()
    )
    on conflict(network_id,store_id) do update
       set last_synced_at=excluded.last_synced_at,
           last_synced_by=excluded.last_synced_by,
           last_result=excluded.last_result,
           updated_at=now();

    return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC untuk halaman Kontrol Pusat.
-- -----------------------------------------------------------------------------
create or replace function public.ldm_primary_owner_catalog_status()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
    v_network_id uuid;
    v_primary_store_id uuid;
    v_result jsonb;
begin
    v_network_id := public.ldm_primary_owner_network_id();
    select sns.store_id into v_primary_store_id
    from public.store_network_stores sns
    where sns.network_id=v_network_id
      and sns.is_primary=true and sns.active=true
    limit 1;

    select jsonb_build_object(
        'network_id',v_network_id,
        'primary_store_id',v_primary_store_id,
        'primary_product_count',(
            select count(*) from public.products p
            where p.store_id=v_primary_store_id
              and p.active=true and p.deleted_at is null
        ),
        'branches',coalesce(jsonb_agg(jsonb_build_object(
            'store_id',s.id,
            'store_code',s.code,
            'store_name',s.name,
            'enabled',coalesce(cs.enabled,false),
            'last_synced_at',cs.last_synced_at,
            'last_result',coalesce(cs.last_result,'{}'::jsonb),
            'product_count',(
                select count(*) from public.products p
                where p.store_id=s.id and p.active=true and p.deleted_at is null
            ),
            'linked_count',(
                select count(*) from public.product_catalog_links l
                where l.network_id=v_network_id and l.branch_store_id=s.id
            )
        ) order by lower(s.name)),'[]'::jsonb)
    ) into v_result
    from public.store_network_stores sns
    join public.stores s on s.id=sns.store_id and s.deleted_at is null
    left join public.product_catalog_sync_settings cs
      on cs.network_id=sns.network_id and cs.store_id=sns.store_id
    where sns.network_id=v_network_id
      and sns.is_primary=false and sns.active=true;

    return v_result;
end;
$$;

create or replace function public.ldm_primary_owner_sync_catalog(
    p_store_id uuid,
    p_enable_auto_sync boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_network_id uuid;
    v_primary_store_id uuid;
    v_result jsonb;
begin
    v_network_id := public.ldm_primary_owner_network_id();
    select sns.store_id into v_primary_store_id
    from public.store_network_stores sns
    where sns.network_id=v_network_id and sns.is_primary=true and sns.active=true
    limit 1;

    if not exists(
        select 1 from public.store_network_stores sns
        where sns.network_id=v_network_id and sns.store_id=p_store_id
          and sns.is_primary=false and sns.active=true
    ) then raise exception 'Cabang tujuan tidak ditemukan pada jaringan Owner Utama.'; end if;

    insert into public.product_catalog_sync_settings(network_id,store_id,enabled,updated_at)
    values(v_network_id,p_store_id,coalesce(p_enable_auto_sync,true),now())
    on conflict(network_id,store_id) do update
       set enabled=excluded.enabled,updated_at=now();

    v_result := public.ldm_sync_catalog_store_internal(
        v_network_id,v_primary_store_id,p_store_id,auth.uid()
    );
    return v_result || jsonb_build_object('auto_sync',coalesce(p_enable_auto_sync,true));
end;
$$;

create or replace function public.ldm_primary_owner_set_catalog_sync(
    p_store_id uuid,
    p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_network_id uuid;
begin
    v_network_id := public.ldm_primary_owner_network_id();
    if not exists(
        select 1 from public.store_network_stores sns
        where sns.network_id=v_network_id and sns.store_id=p_store_id
          and sns.is_primary=false and sns.active=true
    ) then raise exception 'Cabang tujuan tidak ditemukan pada jaringan Owner Utama.'; end if;

    insert into public.product_catalog_sync_settings(network_id,store_id,enabled,updated_at)
    values(v_network_id,p_store_id,coalesce(p_enabled,false),now())
    on conflict(network_id,store_id) do update
       set enabled=excluded.enabled,updated_at=now();

    if coalesce(p_enabled,false) then
        return public.ldm_primary_owner_sync_catalog(p_store_id,true);
    end if;
    return jsonb_build_object('store_id',p_store_id,'auto_sync',false,'updated_at',now());
end;
$$;

create or replace function public.ldm_primary_owner_sync_all_catalog(
    p_enable_auto_sync boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
    v_network_id uuid;
    v_branch record;
    v_rows jsonb := '[]'::jsonb;
begin
    v_network_id := public.ldm_primary_owner_network_id();
    for v_branch in
        select sns.store_id
        from public.store_network_stores sns
        where sns.network_id=v_network_id
          and sns.is_primary=false and sns.active=true
        order by sns.joined_at
    loop
        v_rows := v_rows || jsonb_build_array(
            public.ldm_primary_owner_sync_catalog(v_branch.store_id,p_enable_auto_sync)
        );
    end loop;
    return jsonb_build_object('branches',v_rows,'count',jsonb_array_length(v_rows));
end;
$$;

-- -----------------------------------------------------------------------------
-- Perubahan produk pusat diteruskan otomatis hanya ke cabang yang enabled=true.
-- -----------------------------------------------------------------------------
create or replace function public.ldm_propagate_primary_catalog_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
    v_product_id uuid := case when tg_op='DELETE' then old.id else new.id end;
    v_store_id uuid := case when tg_op='DELETE' then old.store_id else new.store_id end;
    v_network_id uuid;
    v_branch record;
begin
    if coalesce(current_setting('ldm.catalog_sync_internal',true),'')='on' then
        if tg_op='DELETE' then return old; end if;
        return new;
    end if;

    select sns.network_id into v_network_id
    from public.store_network_stores sns
    where sns.store_id=v_store_id
      and sns.is_primary=true and sns.active=true
    limit 1;

    if v_network_id is not null then
        for v_branch in
            select cs.store_id
            from public.product_catalog_sync_settings cs
            join public.store_network_stores sns
              on sns.network_id=cs.network_id and sns.store_id=cs.store_id
             and sns.is_primary=false and sns.active=true
            where cs.network_id=v_network_id and cs.enabled=true
        loop
            perform public.ldm_sync_catalog_product_internal(
                v_network_id,v_store_id,v_branch.store_id,v_product_id
            );
            update public.product_catalog_sync_settings
               set last_synced_at=now(),
                   last_synced_by=auth.uid(),
                   last_result=jsonb_build_object(
                       'mode','automatic','primary_product_id',v_product_id,'synced_at',now()
                   ),
                   updated_at=now()
             where network_id=v_network_id and store_id=v_branch.store_id;
        end loop;
    end if;

    if tg_op='DELETE' then return old; end if;
    return new;
end;
$$;

drop trigger if exists trg_stage26_catalog_auto_insert_delete on public.products;
create trigger trg_stage26_catalog_auto_insert_delete
after insert or delete on public.products
for each row execute function public.ldm_propagate_primary_catalog_change();

drop trigger if exists trg_stage26_catalog_auto_update on public.products;
create trigger trg_stage26_catalog_auto_update
after update of barcode,name,category,unit,purchase_unit,purchase_unit_factor,
    purchase_price,sale_price,promo_active,promo_name,promo_type,promo_value,
    promo_price,promo_min_qty,promo_start_date,promo_end_date,active,deleted_at
on public.products
for each row execute function public.ldm_propagate_primary_catalog_change();

-- -----------------------------------------------------------------------------
-- Tutup RPC katalog lama dan buka satu pintu yang telah memeriksa Owner Pusat.
-- -----------------------------------------------------------------------------
revoke execute on function public.ldm_import_legacy_products(jsonb) from authenticated;
revoke execute on function public.ldm_save_product_units_bulk(jsonb) from authenticated;
revoke execute on function public.ldm_sync_products_stage20(jsonb) from authenticated;
revoke execute on function public.ldm_save_advanced_promos_bulk(jsonb) from authenticated;

create or replace function public.ldm_sync_products_stage21(p_products jsonb)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
    v_count integer;
begin
    if not public.ldm_can_manage_central_catalog() then
        raise exception 'KATALOG_PUSAT_TERKUNCI: pindah ke cabang pusat dan gunakan akun Owner Utama.';
    end if;
    v_count := public.ldm_sync_products_stage20(p_products);
    perform public.ldm_save_advanced_promos_bulk(p_products);
    return v_count;
end;
$$;

create or replace function public.ldm_soft_delete_product(p_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare v_updated integer;
begin
    if not public.ldm_can_manage_central_catalog() then
        raise exception 'KATALOG_PUSAT_TERKUNCI: hanya Owner Utama pada cabang pusat yang dapat menghapus barang.';
    end if;
    update public.products
       set active=false,deleted_at=now(),deleted_by=auth.uid()
     where id=p_product_id
       and store_id=public.ldm_current_store_id()
       and deleted_at is null;
    get diagnostics v_updated=row_count;
    return v_updated>0;
end;
$$;

revoke all on function public.ldm_can_manage_central_catalog() from public,anon;
revoke all on function public.ldm_guard_central_product_catalog() from public,anon,authenticated;
revoke all on function public.ldm_sync_catalog_product_internal(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.ldm_sync_catalog_store_internal(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.ldm_propagate_primary_catalog_change() from public,anon,authenticated;
revoke all on function public.ldm_primary_owner_catalog_status() from public,anon;
revoke all on function public.ldm_primary_owner_sync_catalog(uuid,boolean) from public,anon;
revoke all on function public.ldm_primary_owner_set_catalog_sync(uuid,boolean) from public,anon;
revoke all on function public.ldm_primary_owner_sync_all_catalog(boolean) from public,anon;
revoke all on function public.ldm_sync_products_stage21(jsonb) from public,anon;
revoke all on function public.ldm_soft_delete_product(uuid) from public,anon;

grant execute on function public.ldm_can_manage_central_catalog() to authenticated;
grant execute on function public.ldm_primary_owner_catalog_status() to authenticated;
grant execute on function public.ldm_primary_owner_sync_catalog(uuid,boolean) to authenticated;
grant execute on function public.ldm_primary_owner_set_catalog_sync(uuid,boolean) to authenticated;
grant execute on function public.ldm_primary_owner_sync_all_catalog(boolean) to authenticated;
grant execute on function public.ldm_sync_products_stage21(jsonb) to authenticated;
grant execute on function public.ldm_soft_delete_product(uuid) to authenticated;

insert into public.ldm_system_meta(key,value)
values
    ('central_product_catalog','ready'),
    ('central_product_catalog_stock_scope','per_store'),
    ('schema_version','26.0')
on conflict(key) do update set value=excluded.value,updated_at=now();

commit;

-- Pemeriksaan cepat setelah RUN:
select
    to_regprocedure('public.ldm_primary_owner_catalog_status()') is not null as status_rpc_ok,
    to_regprocedure('public.ldm_primary_owner_sync_catalog(uuid,boolean)') is not null as sync_rpc_ok,
    to_regprocedure('public.ldm_can_manage_central_catalog()') is not null as catalog_guard_ok;
