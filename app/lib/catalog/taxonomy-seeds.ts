// Default taxonomy trees per storeMode (006a §4.1).
//
// Trees cap at 4 levels deep (root → category → subcategory → leaf). Each
// node supplies a name, optional matchKeywords (drive the keyword-scoring
// matcher), optional axisOverrides (additive over storeMode-level axes),
// and optional children. Slugs auto-derive from name + parent path.
//
// seedTaxonomy is idempotent: it bails when the shop already has any
// TaxonomyNode rows. Triggered from upsertMerchantConfig (config-form save),
// not ensureMerchantConfig — see merchant-config.server.ts.

import type { Prisma, PrismaClient } from "@prisma/client";
import prisma from "../../db.server";
import type { StoreMode } from "./store-axes";
import { slugFromPath } from "./taxonomy";

export type SeedAxisOverride = {
  axis: string;
  type?: "single" | "multi" | "text";
  values?: readonly string[];
  order?: number;
};

export type SeedNode = {
  name: string;
  matchKeywords?: readonly string[];
  axisOverrides?: readonly SeedAxisOverride[];
  children?: readonly SeedNode[];
};

export const SEED_TREES: Record<StoreMode, readonly SeedNode[]> = {
  FASHION: [
    {
      name: "Apparel",
      matchKeywords: ["apparel", "clothing"],
      children: [
        {
          name: "Tops",
          matchKeywords: ["top", "tops"],
          children: [
            { name: "Shirts", matchKeywords: ["shirt", "shirts"] },
            { name: "T-Shirts", matchKeywords: ["t-shirt", "tee", "t shirt", "tshirt"] },
            { name: "Kurtas", matchKeywords: ["kurta", "kurti"] },
            { name: "Polos", matchKeywords: ["polo"] },
            { name: "Sweaters", matchKeywords: ["sweater", "pullover", "jumper", "knitwear"] },
            { name: "Tank Tops", matchKeywords: ["tank top", "tank", "vest top", "camisole"] },
          ],
        },
        {
          name: "Bottoms",
          matchKeywords: ["bottom", "bottoms"],
          children: [
            { name: "Pants", matchKeywords: ["pant", "pants", "trouser", "trousers", "chino", "chinos"] },
            { name: "Jeans", matchKeywords: ["jean", "jeans", "denim"] },
            { name: "Shorts", matchKeywords: ["short", "shorts"] },
            { name: "Skirts", matchKeywords: ["skirt"] },
          ],
        },
        {
          name: "Outerwear",
          matchKeywords: ["outerwear"],
          children: [
            { name: "Jackets", matchKeywords: ["jacket"] },
            { name: "Blazers", matchKeywords: ["blazer"] },
            { name: "Coats", matchKeywords: ["coat", "overcoat", "trench"] },
          ],
        },
        {
          name: "Footwear",
          matchKeywords: ["footwear", "shoe", "shoes"],
          children: [
            { name: "Sneakers", matchKeywords: ["sneaker", "sneakers", "trainers", "running shoes"] },
            { name: "Formal", matchKeywords: ["formal shoe", "oxford", "brogue", "loafer"] },
            { name: "Sandals", matchKeywords: ["sandal", "sandals", "flip flop", "slipper"] },
            { name: "Boots", matchKeywords: ["boot", "boots", "ankle boot"] },
          ],
        },
        {
          name: "Ethnic",
          matchKeywords: ["ethnic", "indian wear", "traditional"],
          children: [
            { name: "Sarees", matchKeywords: ["saree", "sari"] },
            { name: "Lehengas", matchKeywords: ["lehenga", "ghagra"] },
            { name: "Salwar Suits", matchKeywords: ["salwar", "suit", "kurta set", "anarkali"] },
          ],
        },
      ],
    },
    {
      name: "Accessories",
      matchKeywords: ["accessory", "accessories"],
      children: [
        { name: "Belts", matchKeywords: ["belt"] },
        { name: "Bags", matchKeywords: ["bag", "handbag", "backpack", "tote", "clutch"] },
        { name: "Watches", matchKeywords: ["watch", "watches", "wristwatch"] },
        { name: "Sunglasses", matchKeywords: ["sunglasses", "shades", "eyewear"] },
        { name: "Other", matchKeywords: [] },
      ],
    },
    {
      name: "Innerwear",
      matchKeywords: ["innerwear", "underwear", "lingerie"],
      children: [
        { name: "Underwear", matchKeywords: ["underwear", "brief", "boxer", "panty"] },
        { name: "Loungewear", matchKeywords: ["loungewear", "lounge", "tracksuit"] },
        { name: "Sleepwear", matchKeywords: ["sleepwear", "pajama", "pyjama", "nightwear"] },
      ],
    },
  ],

  ELECTRONICS: [
    {
      name: "Computing",
      matchKeywords: ["computer", "computing"],
      children: [
        {
          name: "Laptops",
          matchKeywords: ["laptop", "notebook"],
          children: [
            { name: "Gaming", matchKeywords: ["gaming laptop"] },
            { name: "Business", matchKeywords: ["business laptop", "thinkpad"] },
            { name: "Ultrabook", matchKeywords: ["ultrabook"] },
            { name: "Chromebook", matchKeywords: ["chromebook"] },
          ],
        },
        {
          name: "Desktops",
          matchKeywords: ["desktop", "pc"],
          children: [
            { name: "Tower", matchKeywords: ["tower", "desktop tower"] },
            { name: "All-in-One", matchKeywords: ["all-in-one", "all in one", "imac"] },
            { name: "Mini PC", matchKeywords: ["mini pc", "mini computer", "nuc"] },
          ],
        },
        {
          name: "Tablets",
          matchKeywords: ["tablet", "ipad"],
          children: [
            { name: "Standard", matchKeywords: ["tablet"] },
            { name: "Pro", matchKeywords: ["ipad pro", "tablet pro", "pro tablet"] },
            { name: "E-reader", matchKeywords: ["e-reader", "ereader", "kindle"] },
          ],
        },
      ],
    },
    {
      name: "Mobile",
      matchKeywords: ["mobile"],
      children: [
        {
          name: "Phones",
          matchKeywords: ["phone", "smartphone"],
          children: [
            { name: "Flagship", matchKeywords: ["flagship phone", "pro phone"] },
            { name: "Mid-range", matchKeywords: ["mid range phone", "midrange"] },
            { name: "Budget", matchKeywords: ["budget phone", "entry phone"] },
          ],
        },
        {
          name: "Phone Accessories",
          matchKeywords: ["phone accessory", "phone case"],
          children: [
            { name: "Cases", matchKeywords: ["phone case", "case", "cover"] },
            { name: "Chargers", matchKeywords: ["charger", "phone charger", "wall charger"] },
            { name: "Mounts", matchKeywords: ["phone mount", "car mount", "holder"] },
          ],
        },
      ],
    },
    {
      name: "Audio",
      matchKeywords: ["audio"],
      children: [
        {
          name: "Headphones",
          matchKeywords: ["headphone", "headphones"],
          children: [
            { name: "Over-ear", matchKeywords: ["over-ear", "over ear", "around ear"] },
            { name: "In-ear", matchKeywords: ["in-ear", "in ear", "earphone"] },
            { name: "Earbuds", matchKeywords: ["earbud", "earbuds", "true wireless"] },
          ],
        },
        {
          name: "Speakers",
          matchKeywords: ["speaker"],
          children: [
            { name: "Bluetooth", matchKeywords: ["bluetooth speaker"] },
            { name: "Smart", matchKeywords: ["smart speaker", "echo", "alexa speaker"] },
            { name: "Soundbar", matchKeywords: ["soundbar", "sound bar"] },
          ],
        },
        {
          name: "Microphones",
          matchKeywords: ["microphone", "mic"],
          children: [
            { name: "Studio", matchKeywords: ["studio microphone", "studio mic", "condenser"] },
            { name: "Streaming", matchKeywords: ["streaming microphone", "streaming mic", "usb mic"] },
            { name: "Podcast", matchKeywords: ["podcast microphone", "podcast mic"] },
          ],
        },
      ],
    },
    {
      name: "Wearables",
      matchKeywords: ["wearable", "wearables"],
      children: [
        { name: "Smartwatch", matchKeywords: ["smartwatch", "smart watch", "apple watch"] },
        { name: "Fitness Tracker", matchKeywords: ["fitness tracker", "fitness band", "activity tracker"] },
        { name: "Smart Ring", matchKeywords: ["smart ring", "oura"] },
      ],
    },
    {
      name: "Smart Home",
      matchKeywords: ["smart home"],
      children: [
        { name: "Lights", matchKeywords: ["smart light", "smart bulb", "hue"] },
        { name: "Plugs", matchKeywords: ["smart plug", "smart outlet"] },
        { name: "Cameras", matchKeywords: ["security camera", "smart camera", "doorbell camera"] },
        { name: "Hubs", matchKeywords: ["smart home hub", "hub", "homekit hub"] },
        { name: "Sensors", matchKeywords: ["smart sensor", "motion sensor", "door sensor"] },
      ],
    },
    {
      name: "Gaming",
      matchKeywords: ["gaming"],
      children: [
        { name: "Consoles", matchKeywords: ["console", "playstation", "xbox", "switch"] },
        { name: "Controllers", matchKeywords: ["controller", "gamepad"] },
        { name: "VR", matchKeywords: ["vr", "virtual reality", "meta quest", "oculus"] },
        { name: "Accessories", matchKeywords: ["gaming accessory", "gaming headset", "gaming mouse"] },
      ],
    },
  ],

  FURNITURE: [
    {
      name: "Living Room",
      matchKeywords: ["living room", "living"],
      children: [
        { name: "Sofas", matchKeywords: ["sofa", "couch", "sectional", "loveseat"] },
        { name: "Coffee Tables", matchKeywords: ["coffee table"] },
        { name: "TV Stands", matchKeywords: ["tv stand", "tv unit", "media console"] },
        { name: "Armchairs", matchKeywords: ["armchair", "accent chair", "lounge chair"] },
        { name: "Side Tables", matchKeywords: ["side table", "end table"] },
      ],
    },
    {
      name: "Bedroom",
      matchKeywords: ["bedroom"],
      children: [
        { name: "Beds", matchKeywords: ["bed", "bed frame", "platform bed"] },
        { name: "Dressers", matchKeywords: ["dresser", "chest of drawers"] },
        { name: "Nightstands", matchKeywords: ["nightstand", "bedside table"] },
        { name: "Wardrobes", matchKeywords: ["wardrobe", "armoire", "closet"] },
      ],
    },
    {
      name: "Dining Room",
      matchKeywords: ["dining room", "dining"],
      children: [
        { name: "Dining Tables", matchKeywords: ["dining table"] },
        { name: "Chairs", matchKeywords: ["dining chair", "chair"] },
        { name: "Bar Stools", matchKeywords: ["bar stool", "barstool", "counter stool"] },
        { name: "Sideboards", matchKeywords: ["sideboard", "buffet", "credenza"] },
      ],
    },
    {
      name: "Office",
      matchKeywords: ["office"],
      children: [
        { name: "Desks", matchKeywords: ["desk", "writing desk", "computer desk"] },
        { name: "Office Chairs", matchKeywords: ["office chair", "ergonomic chair", "task chair"] },
        { name: "Bookshelves", matchKeywords: ["bookshelf", "bookcase"] },
        { name: "Filing Cabinets", matchKeywords: ["filing cabinet", "file cabinet"] },
      ],
    },
    {
      name: "Outdoor",
      matchKeywords: ["outdoor", "patio", "garden"],
      children: [
        { name: "Patio Sets", matchKeywords: ["patio set", "patio furniture", "outdoor set"] },
        { name: "Sun Loungers", matchKeywords: ["sun lounger", "chaise lounge", "lounger"] },
        { name: "Garden Furniture", matchKeywords: ["garden furniture", "garden chair", "garden bench"] },
        { name: "Umbrellas", matchKeywords: ["patio umbrella", "outdoor umbrella", "parasol"] },
      ],
    },
    {
      name: "Storage",
      matchKeywords: ["storage"],
      children: [
        { name: "Shelving", matchKeywords: ["shelving", "shelf", "shelves"] },
        { name: "Cabinets", matchKeywords: ["cabinet", "storage cabinet"] },
        { name: "Trunks", matchKeywords: ["trunk", "storage trunk", "chest"] },
        { name: "Organizers", matchKeywords: ["organizer", "storage organizer", "cubby"] },
      ],
    },
    {
      name: "Lighting",
      matchKeywords: ["lighting", "light", "lamp"],
      children: [
        { name: "Floor Lamps", matchKeywords: ["floor lamp", "standing lamp"] },
        { name: "Table Lamps", matchKeywords: ["table lamp", "desk lamp"] },
        { name: "Ceiling Lights", matchKeywords: ["ceiling light", "pendant light", "chandelier"] },
        { name: "Sconces", matchKeywords: ["sconce", "wall sconce", "wall light"] },
      ],
    },
    {
      name: "Decor",
      matchKeywords: ["decor", "home decor"],
      children: [
        { name: "Rugs", matchKeywords: ["rug", "carpet", "area rug"] },
        { name: "Wall Art", matchKeywords: ["wall art", "art print", "painting", "poster"] },
        { name: "Mirrors", matchKeywords: ["mirror", "wall mirror"] },
        { name: "Plants & Planters", matchKeywords: ["planter", "plant pot", "indoor plant"] },
      ],
    },
  ],

  BEAUTY: [
    {
      name: "Skincare",
      matchKeywords: ["skincare", "skin care", "skin"],
      children: [
        {
          name: "Cleansers",
          matchKeywords: ["cleanser", "cleansing"],
          children: [
            { name: "Face Wash", matchKeywords: ["face wash", "facewash"] },
            { name: "Micellar", matchKeywords: ["micellar", "micellar water"] },
            { name: "Oil Cleanser", matchKeywords: ["oil cleanser", "cleansing oil"] },
            { name: "Exfoliators", matchKeywords: ["exfoliator", "scrub", "exfoliant"] },
          ],
        },
        {
          name: "Treatments",
          matchKeywords: ["treatment"],
          children: [
            { name: "Serums", matchKeywords: ["serum"] },
            { name: "Essences", matchKeywords: ["essence"] },
            { name: "Spot Treatments", matchKeywords: ["spot treatment", "acne spot"] },
            { name: "Masks", matchKeywords: ["face mask", "sheet mask", "clay mask"] },
          ],
        },
        {
          name: "Moisturizers",
          matchKeywords: ["moisturizer", "moisturiser", "moisturising"],
          children: [
            { name: "Day Cream", matchKeywords: ["day cream"] },
            { name: "Night Cream", matchKeywords: ["night cream"] },
            { name: "Eye Cream", matchKeywords: ["eye cream"] },
            { name: "Lip Balm", matchKeywords: ["lip balm"] },
          ],
        },
        {
          name: "Sun Care",
          matchKeywords: ["sun care", "spf"],
          children: [
            { name: "Sunscreen", matchKeywords: ["sunscreen", "sunblock"] },
            { name: "After-Sun", matchKeywords: ["after sun", "after-sun"] },
            { name: "SPF Lip", matchKeywords: ["spf lip", "lip sunscreen"] },
          ],
        },
      ],
    },
    {
      name: "Makeup",
      matchKeywords: ["makeup"],
      children: [
        {
          name: "Face",
          matchKeywords: ["face makeup"],
          children: [
            { name: "Foundation", matchKeywords: ["foundation"] },
            { name: "Concealer", matchKeywords: ["concealer"] },
            { name: "Powder", matchKeywords: ["powder", "setting powder"] },
            { name: "Blush", matchKeywords: ["blush", "blusher"] },
            { name: "Highlighter", matchKeywords: ["highlighter"] },
          ],
        },
        {
          name: "Eyes",
          matchKeywords: ["eye makeup"],
          children: [
            { name: "Eyeshadow", matchKeywords: ["eyeshadow", "eye shadow"] },
            { name: "Liner", matchKeywords: ["eyeliner", "eye liner", "kajal"] },
            { name: "Mascara", matchKeywords: ["mascara"] },
            { name: "Brows", matchKeywords: ["brow", "eyebrow"] },
          ],
        },
        {
          name: "Lips",
          matchKeywords: ["lip"],
          children: [
            { name: "Lipstick", matchKeywords: ["lipstick"] },
            { name: "Gloss", matchKeywords: ["lip gloss", "gloss"] },
            { name: "Liner", matchKeywords: ["lip liner"] },
          ],
        },
      ],
    },
    {
      name: "Haircare",
      matchKeywords: ["haircare", "hair care", "hair"],
      children: [
        {
          name: "Cleansing",
          matchKeywords: ["hair cleansing"],
          children: [
            { name: "Shampoo", matchKeywords: ["shampoo"] },
            { name: "Conditioner", matchKeywords: ["conditioner"] },
            { name: "Scalp Care", matchKeywords: ["scalp", "scalp care", "scalp scrub"] },
          ],
        },
        {
          name: "Treatment",
          matchKeywords: ["hair treatment"],
          children: [
            { name: "Masks", matchKeywords: ["hair mask"] },
            { name: "Serums", matchKeywords: ["hair serum"] },
            { name: "Oils", matchKeywords: ["hair oil"] },
          ],
        },
        {
          name: "Styling",
          matchKeywords: ["hair styling"],
          children: [
            { name: "Gel", matchKeywords: ["hair gel"] },
            { name: "Spray", matchKeywords: ["hair spray", "hairspray"] },
            { name: "Cream", matchKeywords: ["hair cream", "styling cream"] },
            { name: "Mousse", matchKeywords: ["hair mousse", "mousse"] },
          ],
        },
      ],
    },
    {
      name: "Fragrance",
      matchKeywords: ["fragrance", "perfume"],
      children: [
        { name: "Perfume", matchKeywords: ["perfume", "eau de parfum"] },
        { name: "Body Mist", matchKeywords: ["body mist"] },
        { name: "Cologne", matchKeywords: ["cologne", "eau de toilette"] },
      ],
    },
    {
      name: "Body & Bath",
      matchKeywords: ["body", "bath", "bodycare"],
      children: [
        { name: "Body Wash", matchKeywords: ["body wash", "shower gel"] },
        { name: "Lotion", matchKeywords: ["body lotion", "lotion"] },
        { name: "Scrubs", matchKeywords: ["body scrub", "scrub"] },
        { name: "Hand Care", matchKeywords: ["hand cream", "hand care"] },
      ],
    },
    {
      name: "Tools",
      matchKeywords: ["beauty tool", "beauty tools"],
      children: [
        { name: "Brushes", matchKeywords: ["makeup brush", "brush"] },
        { name: "Sponges", matchKeywords: ["beauty sponge", "blender", "makeup sponge"] },
        { name: "Devices", matchKeywords: ["beauty device", "facial device", "led mask"] },
        { name: "Mirrors", matchKeywords: ["vanity mirror", "makeup mirror"] },
      ],
    },
  ],

  JEWELLERY: [
    {
      name: "Rings",
      matchKeywords: ["ring", "rings"],
      children: [
        { name: "Engagement", matchKeywords: ["engagement ring", "solitaire"] },
        { name: "Wedding Bands", matchKeywords: ["wedding band", "wedding ring"] },
        { name: "Daily Wear", matchKeywords: ["daily wear ring", "everyday ring"] },
        { name: "Cocktail", matchKeywords: ["cocktail ring", "statement ring"] },
        { name: "Stackable", matchKeywords: ["stackable ring", "stacking ring"] },
        { name: "Toe Rings", matchKeywords: ["toe ring", "bichhua"] },
      ],
    },
    {
      name: "Necklaces",
      matchKeywords: ["necklace", "necklaces"],
      children: [
        { name: "Chains", matchKeywords: ["chain", "neck chain"] },
        { name: "Pendants", matchKeywords: ["pendant", "locket"] },
        { name: "Chokers", matchKeywords: ["choker"] },
        { name: "Long Necklaces", matchKeywords: ["long necklace", "rani haar", "haar"] },
        { name: "Mangalsutras", matchKeywords: ["mangalsutra", "mangal sutra"] },
      ],
    },
    {
      name: "Earrings",
      matchKeywords: ["earring", "earrings"],
      children: [
        { name: "Studs", matchKeywords: ["stud", "stud earring", "studs"] },
        { name: "Hoops", matchKeywords: ["hoop", "hoop earring", "hoops"] },
        { name: "Drops", matchKeywords: ["drop earring", "drops"] },
        { name: "Chandbalis", matchKeywords: ["chandbali", "chand bali"] },
        { name: "Jhumkas", matchKeywords: ["jhumka", "jhumki"] },
        { name: "Ear Cuffs", matchKeywords: ["ear cuff", "earcuff"] },
      ],
    },
    {
      name: "Bracelets",
      matchKeywords: ["bracelet", "bracelets"],
      children: [
        { name: "Bangles", matchKeywords: ["bangle", "bangles"] },
        { name: "Cuffs", matchKeywords: ["cuff", "cuff bracelet"] },
        { name: "Charm Bracelets", matchKeywords: ["charm bracelet", "charm"] },
        { name: "Tennis Bracelets", matchKeywords: ["tennis bracelet"] },
        { name: "Kadas", matchKeywords: ["kada", "kadas"] },
      ],
    },
    {
      name: "Anklets",
      matchKeywords: ["anklet", "anklets", "payal"],
      children: [
        { name: "Single", matchKeywords: ["single anklet"] },
        { name: "Pair", matchKeywords: ["anklet pair"] },
        { name: "Sets", matchKeywords: ["anklet set"] },
      ],
    },
    {
      name: "Sets",
      matchKeywords: ["jewellery set", "jewelry set", "set"],
      children: [
        { name: "Bridal Sets", matchKeywords: ["bridal set", "bridal jewellery"] },
        { name: "Festive Sets", matchKeywords: ["festive set", "festive jewellery"] },
        { name: "Daily Wear Sets", matchKeywords: ["daily wear set", "everyday set"] },
      ],
    },
    {
      name: "Body Jewellery",
      matchKeywords: ["body jewellery", "body jewelry"],
      children: [
        { name: "Nose Rings", matchKeywords: ["nose ring", "nath", "nose pin"] },
        { name: "Belly Chains", matchKeywords: ["belly chain", "waist chain", "kamar bandh"] },
        { name: "Hair Accessories", matchKeywords: ["hair accessory", "maang tikka", "tika", "hair jewellery"] },
      ],
    },
    {
      name: "Men's Jewellery",
      matchKeywords: ["men's jewellery", "mens jewellery", "men's jewelry"],
      children: [
        { name: "Chains", matchKeywords: ["men's chain", "mens chain"] },
        { name: "Bracelets", matchKeywords: ["men's bracelet", "mens bracelet"] },
        { name: "Rings", matchKeywords: ["men's ring", "mens ring"] },
        { name: "Cufflinks", matchKeywords: ["cufflink", "cufflinks"] },
      ],
    },
    {
      name: "Children's Jewellery",
      matchKeywords: ["children's jewellery", "kids jewellery", "kids jewelry"],
      children: [
        { name: "Earrings", matchKeywords: ["kids earring", "children's earring"] },
        { name: "Pendants", matchKeywords: ["kids pendant", "children's pendant"] },
        { name: "Bracelets", matchKeywords: ["kids bracelet", "children's bracelet"] },
      ],
    },
  ],

  // GENERAL ships only a single root node — merchants build the tree manually
  // because no canonical product taxonomy applies. (006a §3.3 — multi-industry
  // expansion: GENERAL is intentionally minimal.)
  GENERAL: [{ name: "All Products", matchKeywords: [] }],
};

type Tx = PrismaClient | Prisma.TransactionClient;

export async function seedTaxonomy(
  shopDomain: string,
  storeMode: StoreMode,
  tx: Tx = prisma,
): Promise<{ created: number; skipped: boolean }> {
  // Idempotency guard: any existing rows mean a previous seed (or merchant
  // edits) already happened. Skip silently to avoid clobbering merchant work.
  const existing = await tx.taxonomyNode.count({ where: { shopDomain } });
  if (existing > 0) return { created: 0, skipped: true };

  const tree = SEED_TREES[storeMode];
  let created = 0;
  for (let i = 0; i < tree.length; i += 1) {
    created += await createSubtree(tx, shopDomain, tree[i], null, "", i);
  }
  return { created, skipped: false };
}

async function createSubtree(
  tx: Tx,
  shopDomain: string,
  node: SeedNode,
  parentId: string | null,
  parentSlug: string,
  position: number,
): Promise<number> {
  const slug = slugFromPath(parentSlug, node.name);
  const created = await tx.taxonomyNode.create({
    data: {
      shopDomain,
      parentId,
      name: node.name,
      slug,
      position,
      axisOverrides: (node.axisOverrides ?? []) as unknown as Prisma.InputJsonValue,
      matchKeywords: [...(node.matchKeywords ?? [])],
    },
  });
  let count = 1;
  const children = node.children ?? [];
  for (let i = 0; i < children.length; i += 1) {
    count += await createSubtree(tx, shopDomain, children[i], created.id, slug, i);
  }
  return count;
}
