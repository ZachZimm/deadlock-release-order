using System.Security.Cryptography;
using System.Text.Json;
using ValveKeyValue;
using ValveResourceFormat;
using ValveResourceFormat.ResourceTypes;

if (args.Length != 4)
{
    Console.Error.WriteLine("Usage: UiPatcher native.vxml_c script.js OUTPUT_DIRECTORY audit.json");
    return 2;
}

using var layout = new Resource();
layout.Read(args[0]);
var snapshots = layout.Blocks.Select(block => block.ToString()).ToArray();
var ast = (BinaryKV3)layout.GetBlockByType(BlockType.LaCo)!;
var root = ast.Data.Root["m_AST"]["m_pRoot"];
var originalChildren = root["vecChildren"];
if (originalChildren.Any(pair => (string?)pair.Value["eType"] == "SCRIPTS"))
{
    throw new InvalidDataException("Native layout now contains scripts; review the integration before rebuilding.");
}
var include = Node("INCLUDE");
var reference = Node("REFERENCE_COMPILED");
reference["name"] = new KVObject("panorama/scripts/release_order.vjs_c");
include["child"] = reference;
var scriptList = Node("SCRIPTS");
scriptList["child"] = include;
var newChildren = KVObject.Array();
foreach (var (_, child) in originalChildren)
{
    newChildren.Add(child);
    if ((string?)child["eType"] == "STYLES")
    {
        newChildren.Add(scriptList);
    }
}
root["vecChildren"] = newChildren;

var layoutPath = Path.Combine(args[2], "panorama/layout/popups/citadel_popup_roster_select.vxml_c");
Directory.CreateDirectory(Path.GetDirectoryName(layoutPath)!);
using (var output = File.Create(layoutPath))
{
    layout.Serialize(output);
}
using var written = new Resource();
written.Read(layoutPath);
var writtenAst = ((BinaryKV3)written.GetBlockByType(BlockType.LaCo)!).Data.Root["m_AST"]["m_pRoot"];
var writtenChildren = writtenAst["vecChildren"];
var inserted = writtenChildren.Single(pair => (string?)pair.Value["eType"] == "SCRIPTS").Value;
if ((string?)inserted["eType"] != "SCRIPTS"
    || (string?)inserted["child"]["child"]["name"] != "panorama/scripts/release_order.vjs_c")
{
    throw new InvalidDataException("Script include failed to roundtrip.");
}
var restored = KVObject.Array();
foreach (var (_, child) in writtenChildren.Where(pair => (string?)pair.Value["eType"] != "SCRIPTS"))
{
    restored.Add(child);
}
writtenAst["vecChildren"] = restored;
for (var i = 0; i < snapshots.Length; i++)
{
    // Panorama's decoded DATA output reflects LaCo and must also match after restoration.
    if (written.Blocks[i].ToString() != snapshots[i])
    {
        throw new InvalidDataException($"Unexpected layout change in {written.Blocks[i].Type}.");
    }
}

var scriptPath = Path.Combine(args[2], "panorama/scripts/release_order.vjs_c");
Directory.CreateDirectory(Path.GetDirectoryName(scriptPath)!);
var payload = File.ReadAllBytes(args[1]);
// PanoramaScript v4 stores raw UTF-8 in DATA (no legacy CRC/image prefix).
// The resource envelope has one DATA block and no compiler-only metadata.
using (var output = new BinaryWriter(File.Create(scriptPath)))
{
    output.Write((uint)(28 + payload.Length));
    output.Write((ushort)12);
    output.Write((ushort)4);
    output.Write((uint)8);
    output.Write((uint)1);
    output.Write(new byte[] { 68, 65, 84, 65 });
    output.Write((uint)8);
    output.Write((uint)payload.Length);
    output.Write(payload);
}
using var writtenScript = new Resource();
writtenScript.Read(scriptPath);
if (!((Panorama)writtenScript.DataBlock!).Data.SequenceEqual(File.ReadAllBytes(args[1])))
{
    throw new InvalidDataException("Script binary failed to roundtrip.");
}
var audit = new
{
    only_script_include_added = true,
    native_layout_sha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(args[0]))),
    layout_sha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(layoutPath))),
    script_sha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(scriptPath))),
    files = new[] { "panorama/layout/popups/citadel_popup_roster_select.vxml_c", "panorama/scripts/release_order.vjs_c" },
};
File.WriteAllText(args[3], JsonSerializer.Serialize(audit, new JsonSerializerOptions { WriteIndented = true }) + "\n");
Console.WriteLine("Native layout preserved; one script include added; script and layout roundtrip verified.");
return 0;

static KVObject Node(string type)
{
    var node = KVObject.Collection();
    node["eType"] = new KVObject(type);
    return node;
}
