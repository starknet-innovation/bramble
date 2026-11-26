#!/usr/bin/env python3
"""Generic FIPS 205 SLH-DSA reference for the 128s parameter set (spike; stdlib only).

Instantiations:
  shake   - FIPS 205 §11.1 SLH-DSA-SHAKE-128s
  sha2    - FIPS 205 §11.2.1 SLH-DSA-SHA2-128s (category 1)
  blake2s - non-standard SLH-DSA-BLAKE2s-128s (this spike):
      F/H/T_l(PK.seed, ADRS, M) = Trunc_n(BLAKE2s(PK.seed || 0^{64-n} || ADRS || M))  (full 32-byte ADRS)
      PRF(PK.seed, SK.seed, ADRS) = Trunc_n(BLAKE2s(PK.seed || 0^{64-n} || ADRS || SK.seed))
      PRF_msg(SK.prf, opt_rand, M) = Trunc_n(HMAC-BLAKE2s-256(SK.prf, opt_rand || M))
      H_msg(R, PK.seed, PK.root, M) = MGF1-BLAKE2s-256(R || PK.seed || BLAKE2s(R || PK.seed || PK.root || M), m)
"""
import hashlib
import hmac

N, H, D, HP, A, K, LGW, M = 16, 63, 7, 9, 12, 14, 4, 30
W = 16
LEN1, LEN2 = 32, 3
LEN = LEN1 + LEN2

WOTS_HASH, WOTS_PK, TREE, FORS_TREE, FORS_ROOTS, WOTS_PRF, FORS_PRF = 0, 1, 2, 3, 4, 5, 6


def to_byte(x, n):
    return x.to_bytes(n, "big")


class Adrs:
    __slots__ = ("b",)

    def __init__(self, b=None):
        self.b = bytearray(32) if b is None else bytearray(b)

    def copy(self):
        return Adrs(self.b)

    def set_layer(self, l):
        self.b[0:4] = to_byte(l, 4)

    def set_tree(self, t):
        self.b[4:16] = to_byte(t, 12)

    def set_type_and_clear(self, y):
        self.b[16:20] = to_byte(y, 4)
        self.b[20:32] = bytes(12)

    def set_key_pair(self, i):
        self.b[20:24] = to_byte(i, 4)

    def key_pair(self):
        return int.from_bytes(self.b[20:24], "big")

    def set_chain(self, i):
        self.b[24:28] = to_byte(i, 4)

    set_tree_height = set_chain

    def set_hash(self, i):
        self.b[28:32] = to_byte(i, 4)

    set_tree_index = set_hash

    def tree_index(self):
        return int.from_bytes(self.b[28:32], "big")

    def compressed(self):
        b = self.b
        return bytes(b[3:4]) + bytes(b[8:16]) + bytes(b[19:20]) + bytes(b[20:32])


def mgf1(hashfn, seed, length):
    out = b""
    c = 0
    while len(out) < length:
        out += hashfn(seed + to_byte(c, 4))
        c += 1
    return out[:length]


class Shake:
    name = "SLH-DSA-SHAKE-128s"

    @staticmethod
    def _s(data, n):
        return hashlib.shake_256(data).digest(n)

    def tweak(self, pk_seed, adrs, m):
        return self._s(pk_seed + bytes(adrs.b) + m, N)

    def prf(self, pk_seed, sk_seed, adrs):
        return self._s(pk_seed + bytes(adrs.b) + sk_seed, N)

    def prf_msg(self, sk_prf, opt_rand, m):
        return self._s(sk_prf + opt_rand + m, N)

    def h_msg(self, r, pk_seed, pk_root, m):
        return self._s(r + pk_seed + pk_root + m, M)


class _MdLike:
    """SHA2-style instantiation over a 64-byte-block hash `hfn` (category 1 form)."""

    def __init__(self, hfn, digestmod, full_adrs):
        self.hfn = hfn
        self.digestmod = digestmod
        self.full_adrs = full_adrs

    def _a(self, adrs):
        return bytes(adrs.b) if self.full_adrs else adrs.compressed()

    def tweak(self, pk_seed, adrs, m):
        return self.hfn(pk_seed + bytes(64 - N) + self._a(adrs) + m)[:N]

    def prf(self, pk_seed, sk_seed, adrs):
        return self.hfn(pk_seed + bytes(64 - N) + self._a(adrs) + sk_seed)[:N]

    def prf_msg(self, sk_prf, opt_rand, m):
        return hmac.new(sk_prf, opt_rand + m, self.digestmod).digest()[:N]

    def h_msg(self, r, pk_seed, pk_root, m):
        inner = self.hfn(r + pk_seed + pk_root + m)
        return mgf1(self.hfn, r + pk_seed + inner, M)


def _sha256(b):
    return hashlib.sha256(b).digest()


def _blake2s(b):
    return hashlib.blake2s(b).digest()


class Sha2(_MdLike):
    name = "SLH-DSA-SHA2-128s"

    def __init__(self):
        super().__init__(_sha256, hashlib.sha256, full_adrs=False)


class Blake2s(_MdLike):
    name = "SLH-DSA-BLAKE2s-128s"

    def __init__(self):
        super().__init__(_blake2s, hashlib.blake2s, full_adrs=True)


INSTANTIATIONS = {"shake": Shake, "sha2": Sha2, "blake2s": Blake2s}


def base_2b(x, b, out_len):
    i = 0
    bits = 0
    total = 0
    out = []
    for _ in range(out_len):
        while bits < b:
            total = (total << 8) + x[i]
            i += 1
            bits += 8
        bits -= b
        out.append((total >> bits) % (1 << b))
    return out


class Slh:
    def __init__(self, inst):
        self.c = inst

    # --- WOTS+ ---
    def chain(self, x, i, s, pk_seed, adrs):
        tmp = x
        for j in range(i, i + s):
            adrs.set_hash(j)
            tmp = self.c.tweak(pk_seed, adrs, tmp)
        return tmp

    def wots_pkgen(self, sk_seed, pk_seed, adrs):
        sk_adrs = adrs.copy()
        sk_adrs.set_type_and_clear(WOTS_PRF)
        sk_adrs.set_key_pair(adrs.key_pair())
        tmp = []
        for i in range(LEN):
            sk_adrs.set_chain(i)
            sk = self.c.prf(pk_seed, sk_seed, sk_adrs)
            adrs.set_chain(i)
            tmp.append(self.chain(sk, 0, W - 1, pk_seed, adrs))
        pk_adrs = adrs.copy()
        pk_adrs.set_type_and_clear(WOTS_PK)
        pk_adrs.set_key_pair(adrs.key_pair())
        return self.c.tweak(pk_seed, pk_adrs, b"".join(tmp))

    def _msg_digits(self, m):
        msg = base_2b(m, LGW, LEN1)
        csum = sum(W - 1 - d for d in msg)
        csum <<= (8 - ((LEN2 * LGW) % 8)) % 8
        msg += base_2b(to_byte(csum, (LEN2 * LGW + 7) // 8), LGW, LEN2)
        return msg

    def wots_sign(self, m, sk_seed, pk_seed, adrs):
        msg = self._msg_digits(m)
        sk_adrs = adrs.copy()
        sk_adrs.set_type_and_clear(WOTS_PRF)
        sk_adrs.set_key_pair(adrs.key_pair())
        sig = []
        for i in range(LEN):
            sk_adrs.set_chain(i)
            sk = self.c.prf(pk_seed, sk_seed, sk_adrs)
            adrs.set_chain(i)
            sig.append(self.chain(sk, 0, msg[i], pk_seed, adrs))
        return sig

    def wots_pk_from_sig(self, sig, m, pk_seed, adrs):
        msg = self._msg_digits(m)
        tmp = []
        for i in range(LEN):
            adrs.set_chain(i)
            tmp.append(self.chain(sig[i], msg[i], W - 1 - msg[i], pk_seed, adrs))
        pk_adrs = adrs.copy()
        pk_adrs.set_type_and_clear(WOTS_PK)
        pk_adrs.set_key_pair(adrs.key_pair())
        return self.c.tweak(pk_seed, pk_adrs, b"".join(tmp))

    # --- XMSS ---
    def xmss_node(self, sk_seed, i, z, pk_seed, adrs):
        # iterative: compute all leaves of subtree, then hash up
        nodes = []
        for leaf in range(i << z, (i + 1) << z):
            adrs.set_type_and_clear(WOTS_HASH)
            adrs.set_key_pair(leaf)
            nodes.append(self.wots_pkgen(sk_seed, pk_seed, adrs))
        height = 0
        base = i << z
        while len(nodes) > 1:
            height += 1
            base >>= 1
            nxt = []
            for j in range(0, len(nodes), 2):
                adrs.set_type_and_clear(TREE)
                adrs.set_tree_height(height)
                adrs.set_tree_index(base + j // 2)
                nxt.append(self.c.tweak(pk_seed, adrs, nodes[j] + nodes[j + 1]))
            nodes = nxt
        return nodes[0]

    def xmss_tree_levels(self, sk_seed, pk_seed, adrs):
        """All levels of a full XMSS tree (for signing)."""
        leaves = []
        for leaf in range(1 << HP):
            adrs.set_type_and_clear(WOTS_HASH)
            adrs.set_key_pair(leaf)
            leaves.append(self.wots_pkgen(sk_seed, pk_seed, adrs))
        levels = [leaves]
        for height in range(1, HP + 1):
            prev = levels[-1]
            cur = []
            for j in range(len(prev) // 2):
                adrs.set_type_and_clear(TREE)
                adrs.set_tree_height(height)
                adrs.set_tree_index(j)
                cur.append(self.c.tweak(pk_seed, adrs, prev[2 * j] + prev[2 * j + 1]))
            levels.append(cur)
        return levels

    def xmss_sign(self, m, sk_seed, idx, pk_seed, adrs):
        levels = self.xmss_tree_levels(sk_seed, pk_seed, adrs.copy())
        auth = [levels[j][(idx >> j) ^ 1] for j in range(HP)]
        adrs.set_type_and_clear(WOTS_HASH)
        adrs.set_key_pair(idx)
        sig = self.wots_sign(m, sk_seed, pk_seed, adrs)
        return sig + auth, levels[HP][0]

    def xmss_pk_from_sig(self, idx, sig_xmss, m, pk_seed, adrs):
        adrs.set_type_and_clear(WOTS_HASH)
        adrs.set_key_pair(idx)
        sig, auth = sig_xmss[:LEN], sig_xmss[LEN:]
        node = self.wots_pk_from_sig(sig, m, pk_seed, adrs)
        adrs.set_type_and_clear(TREE)
        adrs.set_tree_index(idx)
        for k in range(HP):
            adrs.set_tree_height(k + 1)
            if (idx >> k) & 1 == 0:
                adrs.set_tree_index(adrs.tree_index() // 2)
                node = self.c.tweak(pk_seed, adrs, node + auth[k])
            else:
                adrs.set_tree_index((adrs.tree_index() - 1) // 2)
                node = self.c.tweak(pk_seed, adrs, auth[k] + node)
        return node

    # --- hypertree ---
    def ht_sign(self, m, sk_seed, pk_seed, idx_tree, idx_leaf):
        adrs = Adrs()
        adrs.set_tree(idx_tree)
        sig_tmp, root = self.xmss_sign(m, sk_seed, idx_leaf, pk_seed, adrs)
        sig = list(sig_tmp)
        for j in range(1, D):
            idx_leaf = idx_tree % (1 << HP)
            idx_tree >>= HP
            adrs = Adrs()
            adrs.set_layer(j)
            adrs.set_tree(idx_tree)
            sig_tmp, root = self.xmss_sign(root, sk_seed, idx_leaf, pk_seed, adrs)
            sig += sig_tmp
        return sig

    def ht_verify(self, m, sig_ht, pk_seed, idx_tree, idx_leaf, pk_root):
        step = LEN + HP
        adrs = Adrs()
        adrs.set_tree(idx_tree)
        node = self.xmss_pk_from_sig(idx_leaf, sig_ht[0:step], m, pk_seed, adrs)
        for j in range(1, D):
            idx_leaf = idx_tree % (1 << HP)
            idx_tree >>= HP
            adrs = Adrs()
            adrs.set_layer(j)
            adrs.set_tree(idx_tree)
            node = self.xmss_pk_from_sig(idx_leaf, sig_ht[j * step:(j + 1) * step], node, pk_seed, adrs)
        return node == pk_root

    # --- FORS ---
    def fors_sk(self, sk_seed, pk_seed, adrs, idx):
        sk_adrs = adrs.copy()
        sk_adrs.set_type_and_clear(FORS_PRF)
        sk_adrs.set_key_pair(adrs.key_pair())
        sk_adrs.set_tree_index(idx)
        return self.c.prf(pk_seed, sk_seed, sk_adrs)

    def fors_sign(self, md, sk_seed, pk_seed, adrs):
        indices = base_2b(md, A, K)
        sig = []
        for i in range(K):
            sig.append(self.fors_sk(sk_seed, pk_seed, adrs, i * (1 << A) + indices[i]))
            # full tree i
            leaves = []
            for j in range(1 << A):
                sk = self.fors_sk(sk_seed, pk_seed, adrs, i * (1 << A) + j)
                adrs.set_tree_height(0)
                adrs.set_tree_index(i * (1 << A) + j)
                leaves.append(self.c.tweak(pk_seed, adrs, sk))
            levels = [leaves]
            for height in range(1, A):
                prev = levels[-1]
                cur = []
                for j in range(len(prev) // 2):
                    adrs.set_tree_height(height)
                    adrs.set_tree_index((i * (1 << A) >> height) + j)
                    cur.append(self.c.tweak(pk_seed, adrs, prev[2 * j] + prev[2 * j + 1]))
                levels.append(cur)
            for j in range(A):
                s = (indices[i] >> j) ^ 1
                sig.append(levels[j][s])
        return sig

    def fors_pk_from_sig(self, sig, md, pk_seed, adrs):
        indices = base_2b(md, A, K)
        roots = []
        for i in range(K):
            sk = sig[i * (A + 1)]
            adrs.set_tree_height(0)
            adrs.set_tree_index(i * (1 << A) + indices[i])
            node = self.c.tweak(pk_seed, adrs, sk)
            auth = sig[i * (A + 1) + 1:(i + 1) * (A + 1)]
            for j in range(A):
                adrs.set_tree_height(j + 1)
                if (indices[i] >> j) & 1 == 0:
                    adrs.set_tree_index(adrs.tree_index() // 2)
                    node = self.c.tweak(pk_seed, adrs, node + auth[j])
                else:
                    adrs.set_tree_index((adrs.tree_index() - 1) // 2)
                    node = self.c.tweak(pk_seed, adrs, auth[j] + node)
            roots.append(node)
        pk_adrs = adrs.copy()
        pk_adrs.set_type_and_clear(FORS_ROOTS)
        pk_adrs.set_key_pair(adrs.key_pair())
        return self.c.tweak(pk_seed, pk_adrs, b"".join(roots))

    # --- top level ---
    def keygen(self, sk_seed, sk_prf, pk_seed):
        adrs = Adrs()
        adrs.set_layer(D - 1)
        pk_root = self.xmss_node(sk_seed, 0, HP, pk_seed, adrs)
        return (sk_seed, sk_prf, pk_seed, pk_root), (pk_seed, pk_root)

    def _digest(self, r, pk_seed, pk_root, m):
        digest = self.c.h_msg(r, pk_seed, pk_root, m)
        ka = (K * A + 7) // 8
        md = digest[:ka]
        tmp_tree = digest[ka:ka + (H - HP + 7) // 8]
        tmp_leaf = digest[ka + (H - HP + 7) // 8:ka + (H - HP + 7) // 8 + (HP + 7) // 8]
        idx_tree = int.from_bytes(tmp_tree, "big") % (1 << (H - HP))
        idx_leaf = int.from_bytes(tmp_leaf, "big") % (1 << HP)
        return md, idx_tree, idx_leaf

    def sign_internal(self, m, sk, addrnd=None):
        sk_seed, sk_prf, pk_seed, pk_root = sk
        opt_rand = pk_seed if addrnd is None else addrnd
        r = self.c.prf_msg(sk_prf, opt_rand, m)
        md, idx_tree, idx_leaf = self._digest(r, pk_seed, pk_root, m)
        adrs = Adrs()
        adrs.set_tree(idx_tree)
        adrs.set_type_and_clear(FORS_TREE)
        adrs.set_key_pair(idx_leaf)
        sig_fors = self.fors_sign(md, sk_seed, pk_seed, adrs)
        adrs2 = Adrs()
        adrs2.set_tree(idx_tree)
        adrs2.set_type_and_clear(FORS_TREE)
        adrs2.set_key_pair(idx_leaf)
        pk_fors = self.fors_pk_from_sig(sig_fors, md, pk_seed, adrs2)
        sig_ht = self.ht_sign(pk_fors, sk_seed, pk_seed, idx_tree, idx_leaf)
        return b"".join([r] + sig_fors + sig_ht)

    def verify_internal(self, m, sig, pk):
        pk_seed, pk_root = pk
        if len(sig) != (1 + K * (1 + A) + H + D * LEN) * N:
            return False
        els = [sig[i:i + N] for i in range(0, len(sig), N)]
        r = els[0]
        sig_fors = els[1:1 + K * (1 + A)]
        sig_ht = els[1 + K * (1 + A):]
        md, idx_tree, idx_leaf = self._digest(r, pk_seed, pk_root, m)
        adrs = Adrs()
        adrs.set_tree(idx_tree)
        adrs.set_type_and_clear(FORS_TREE)
        adrs.set_key_pair(idx_leaf)
        pk_fors = self.fors_pk_from_sig(sig_fors, md, pk_seed, adrs)
        return self.ht_verify(pk_fors, sig_ht, pk_seed, idx_tree, idx_leaf, pk_root)

    # pure external interface, empty context
    @staticmethod
    def wrap(m, ctx=b""):
        return to_byte(0, 1) + to_byte(len(ctx), 1) + ctx + m

    def sign(self, m, sk, ctx=b"", addrnd=None):
        return self.sign_internal(self.wrap(m, ctx), sk, addrnd)

    def verify(self, m, sig, pk, ctx=b""):
        return self.verify_internal(self.wrap(m, ctx), sig, pk)
