#!/usr/bin/env python3
"""Copy the useful half of OpenSourceWeb's sound library into assets/osw-sounds/.

Usage: export-sounds.py <path-to-OpenSourceWeb-clone> [<output-dir>]

The source ships 3,559 files and 484 MB of audio, most of it useless here:
616 vox words, 170 MIDI files, 169 piano notes, 170 violin notes, the radio
station tracks, the toilet humour. This takes the parts a game like Bascinet
could actually use, grouped by what the sound is FOR rather than by where the
source filed it.

Nothing is converted or trimmed. Each file is copied byte for byte.
"""
import json, os, shutil, sys

if len(sys.argv) < 2:
    sys.exit("usage: export-sounds.py <path-to-OpenSourceWeb-clone> [<out>]")
SRC = os.path.join(sys.argv[1], "sound")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.normpath(
    os.path.join(ROOT, "assets", "osw-sounds"))
# The commit assets/osw-sprites was taken from. Only used to stamp the
# manifest, so a reader can map a file back to the exact source revision.
COMMIT = "edb003dc8ff5009476a9bcb74e79206039fb3390"

if not os.path.isdir(SRC):
    sys.exit(f"{sys.argv[1]} has no sound/ — that is not an OpenSourceWeb clone")


def files(d, names):
    return [f"{d}/{n}.ogg" for n in names.split()]


def whole(d, drop=()):
    out = []
    for n in sorted(os.listdir(os.path.join(SRC, d))):
        if n.lower().endswith((".ogg", ".wav", ".mp3")) and n not in drop:
            out.append(f"{d}/{n}")
    return out


def rng(d, stem, a, b, ext="ogg"):
    return [f"{d}/{stem}{i}.{ext}" for i in range(a, b + 1)]


GROUPS = {
    # Clicks, switches, beeps — the vocabulary of a button being pressed.
    "ui":
        files("machines", """click ping chime ding twobeep beep5 scan_beep
            console_success console_error warning-buzzer buzz-sigh buzz-two
            lockenable lockreset lwButton signal copier paistartup""")
        + files("effects", """pop snap Load_Character_Preset newBuzzer lever
            lightswitch xylophone1 xylophone2 xylophone3 pageturn1 pageturn2
            pageturn3 rustle1 rustle2 rustle3 coin_m coininsert moeda
            drawer_sound""")
        + rng("effects", "lightswitch_", 1, 4)
        + rng("effects", "ui_lockpicking_pickmovement_0", 1, 4)
        + files("items", "Screwdriver Ratchet Wirecutter zip use_card")
        + files("lfwbsounds", "special_toggle sign_this"),

    # Something wants your attention.
    "notify":
        files("effects", """alert danger_alarm klaxon_alarm siren arrival
            adminhelp mail_generic mail_old mail_rare confession_print radio
            radio1 radio2 radio3 minor_ear_ring short_ear_ring ear_ring
            mob_ringing mob_ringing2 crisis crisis2""")
        + rng("effects", "mail", 1, 4)
        + rng("effects", "knockknock", 1, 6)
        + files("machines", "Alarm door_locked")
        + files("lfwbsounds", "death_alarm airlock_deny2 radio_chatter")
        + files("items", "phone_ring phone_pickup phone_busy phone_calling "
                         "dialtone countdown"),

    # Rooms with a sound of their own. Most of these loop.
    "ambience":
        whole("ambience", drop={"bananaphone.ogg", "song_game.ogg",
                                "desktop.ini"})
        + whole("effects/wind")
        + files("effects", "newfireloop fire torch_big torch_small vent")
        + files("misc", "charon_loop TestLoop1 interference altar")
        + files("machines", "loop_altar hiss"),

    # Longer pieces. A handful of tracks, not the whole 229 MB jukebox.
    "music":
        files("music", """hiding outpost to_hell haruspex haruspex-combat
            ravenheart_combat1 sacred_dagger morning""")
        + whole("fortress_suspense")
        + whole("tension")
        + whole("ThanatiLP"),

    # Hitting, blocking, and being hit.
    "weapons":
        whole("armornew")
        + files("weapons", """2hswing bardiche1 bardiche2 bardiche3 bardiche4
            bash1 bash2 blade1 bladeslice blade_parry1 blade_parry2
            blade_parry3 bladeparry1 bladeparry2 bladeparry3 bladeparry4
            club flail_swing flailhit gavel genhit1 genhit2 genhit3 Genhit
            knife_equip knife_drop drop_sword dagger_draw dagger_sheath
            mace_draw sabre_draw staff_equip axe_sheath axe_unsheath axe_drop
            sword_sheath_01 sword_sheath_02 sword_unsheath_01
            sword_unsheath_02 sword_unsheath_03 bow_draw bow_string
            crossbow_fire crossbow_sheath crossbow_unsheath punch1 punch2
            punch3 punch4 punchmiss slash slashmiss slice smash pierce
            thudswoosh throwtap tablehit1 net_captured net_equip handcuffs
            cablecuff klevec klevec2 klevec3 wpn_swing_axe_01
            wpn_swing_axe_02""")
        + files("lfwbcombatuse", """parry rapier swing_01 swing_02 swing_03
            npc_kill_chop_01 npc_kill_chop_02 npc_kill_chop_03
            npc_kill_slash_01 npc_kill_slash_02 npc_kill_slash_03
            npc_kill_smash_01 npc_kill_smash_02 npc_kill_smash_03""")
        + files("effects", """Explosion1 shield2 shieldbash bars_hit wallhit wallhit2
            wallhit3 woodhit metalwall bone_crack getstuck_dagger
            get_stuck3""")
        + whole("combat2020")
        + whole("projectilesnew"),

    # A day's work: the forge, the mine, the bench.
    "labour":
        files("effects", """forge smelter_sound sharpen_long1 sharpen_long2
            sharpen_short1 sharpen_short2 quench_barrel1 quench_barrel2
            sewing fabric_production dig_shovel empty_shovel shovel_drop
            seedsplanted carve1 carve2 wood_chop_01 wood_chop_02 wood_chop_03
            wood_chop_04 melee_wood_destroy_01 melee_wood_destroy_02
            npc_human_pickaxe_01 npc_human_pickaxe_02 npc_human_pickaxe_03
            npc_human_pickaxe_05 npc_human_wood_drop_01 npc_human_wood_drop_02
            cavein stonestone metal_block_04 gemdrop gemdrop1 gemdrop2""")
        + files("items", """Crowbar Welder Welder2 Deconstruct Screwdriver2
            breaksound haircut scissors polaroid1 polaroid2
            poster_being_created poster_ripped""")
        + files("lfwbsounds", "smelter_fin suture cut_fail"),

    # Doors, chests, ladders, water, torches — the world being handled.
    "world":
        files("effects", """train_arrive door_open2 door_close2 doorcreaky gateopen
            gateclose stonedoor_openclose wood_open wood_close ladder climb
            drsc_treasure_open_01 drsc_treasure_close_01 drsc_wardrobe_open_02
            drsc_wardrobe_close_01 torch_light torch_snuff torch_pickup
            torch_fixture0 torch_fixture1 wooden_move ontable smallfall
            fallsmash glass_step glassknock Glassbr1 Glassbr2
            Glasshit trap trap_arm lockpick_break wlocked1 wlocked2""")
        + whole("water", drop={"desktop.ini"})
        + files("machines", """closet_open closet_close maint_open maint_close
            lightbreak""")
        + files("misc", "chairfall rollermove cloth_rip slip")
        + files("lfwbsounds", """iron_crate_open iron_crate_close double_open1
            double_close lava_open lava_close""")
        + whole("effects/footsteps/dirt")
        + whole("effects/footsteps/wood")
        + whole("effects/footsteps/grass")
        + whole("effects/footsteps/snow"),

    # A body: eating, breathing, hurting, dying.
    "body":
        files("effects", """reg_eat1 reg_eat2 crunchychewing
            glass_drink1 glass_drink2 gurgle1 gurgle2 bodyfall1 bodyfall2
            blood1 blood2 blood3 splat squelch1 squishy flesh_drop throat
            man_pain1 man_pain2 man_pain3 woman_pain2 woman_pain3 woman_pain4
            hungry1 hungry2 hungry3 hungry4 badmood1 badmood2 badmood3
            badmood4 heartbeat_scared heartbeatfailure drown drown_female
            tourniquet""")
        + ["effects/Heart Beat.ogg"]
        + files("lfwbsounds", """fear_scream1 fear_scream2 fear_woman1
            fear_woman2 bones newheart shlep""")
        + files("items", "eatfood drink")
        + files("voice/emotes/cough", "cough_01 cough_female cough_oldman")
        + files("voice/emotes/sigh", "sigh_male sigh_female")
        + files("voice/emotes/whimper", "whimper_male whimper_female")
        + files("voice/emotes/snores", "snore1 snore2"),

    # The Tower's own noises: the grates, the keys, the blood being taken.
    "lifeweb":
        whole("LW2")
        + files("ambience", "lifeweb2b")
        + files("lfwbsounds", """bishop_banish oldways_convert thanati_key
            wonder wonder_secret_known wondermaker seen_wonder rebirth
            they_absorb they_contact1 they_learn grue1 grue_kill"""),

    # The things that live down there, matching the creature sprites.
    "creatures":
        files("effects", """rat_life rat_life2 rat_attack rat_death rat_pack
            mousesqueek strygh_life1 strygh_life2 strygh_spot
            strygh_attack_01 strygh_attack_02 strygh_death_01 graga_life1
            graga_life2 graga_attack6 graga_step1 graga_step2 tzanzlife1
            tzanzlife2 tzanzlife3 tzanz_walk2 kthanid_life kthanid_spot
            kthanid_attack kthanid_pain kthanid_move arl_step maggot1 maggot2
            maggotd screech ghost ghost2""")
        + files("lfwbsounds", "bark bee_attack1 lump_spawn lump_active"),
}

manifest = {}
kept = dropped = 0
total = 0
lines = []
for group, paths in GROUPS.items():
    d = os.path.join(OUT, group)
    os.makedirs(d, exist_ok=True)
    n = size = 0
    for rel in sorted(set(paths)):
        src = os.path.join(SRC, rel)
        if not os.path.exists(src):
            print("  missing", rel)
            dropped += 1
            continue
        shutil.copyfile(src, os.path.join(d, os.path.basename(rel)))
        manifest.setdefault(group, []).append(rel)
        n += 1
        size += os.path.getsize(src)
    kept += n
    total += size
    lines.append(f"  {group:<10} {n:>4} files  {size/1e6:>6.1f} MB")

with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump({"commit": COMMIT, "groups": manifest}, f, indent=1)

print("\n".join(lines))
print(f"  {'total':<10} {kept:>4} files  {total/1e6:>6.1f} MB"
      + (f"   ({dropped} missing)" if dropped else ""))
