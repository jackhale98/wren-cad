// Whittle kernel façade — M5 STEP AP242 PMI (ADR-100): semantic GD&T (dimensions, geometric
// tolerances, datums) plus tessellated presentation, written through XCAF and read back.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Part of the amalgamated façade translation unit (see whittle_core.cpp); not compiled alone.
//
// Export (`exportStepPmi`): the worker hands contracts `PmiExportItem`s (targets: body = 0-based
// index into the exported shapes, kind + 1-based TopExp index). Each item becomes an
// XCAFDoc_DimTolTool label on sub-shape labels (XCAFDoc_ShapeTool::AddSubShape) and
// STEPCAFControl_Writer writes them with writeDGTsAP242 (AP242 schema only). Items that cannot be
// written are skipped with a reason; nothing is half-written (every input is validated before a
// GD&T label is created).
//
// Identity: OCCT writes the CAx-IF names for dimensions ('linear distance', 'diameter', …) and
// empty names for tolerances and datums, so the annotation id travels as
//   - the presentation name (draughting_callout.name), which the reader returns as the
//     object's presentation name: the round trip reads it back from there, and
//   - the shape_aspect / geometric_item_specific_usage name of dimensions and tolerances (the
//     writer takes it from the GD&T label's TDataStd_Name after its first space; OCCT's reader
//     ignores it, other tools show it).
// Without presentation (`pmi.presentation: false`) the ids therefore do not survive OCCT's reader.
//
// Units: the document is in mm; angles are written in radians (the writer's context unit is the
// radian) and OCCT's reader converts angular values to degrees, which the import converts back.
//
// Import (`importFile` STEP): every XCAF dimension, tolerance and datum becomes a contracts
// `PmiImportItem` on the returned bodies' TopExp indices; what cannot be mapped or read becomes an
// issue with a stable `code` and a `severity` (lost, approximated, cosmetic). Where OCCT 8.0.1's
// reader drops what the file states (datum faces given otherwise than by a
// geometric_item_specific_usage, datums no tolerance references, measuring directions, typed
// SET_REPRESENTATION_ITEM lists, complex GD&T entities it has no class for), the STEP model is
// read directly (whittle_pmi_step.cpp); nothing is inferred from geometry.
//
// Contract v2 (ADR-101): written where XCAF or the STEP model can hold it (see the export
// functions and applyPmiStepFixups), noted in the export report where not.

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

// Thrown while validating one export item: the item is skipped with this reason.
struct PmiSkip {
  std::string reason;
};

[[noreturn]] void skipPmi(std::string reason) { throw PmiSkip{std::move(reason)}; }

struct ToleranceTypeName {
  const char* name;
  XCAFDimTolObjects_GeomToleranceType type;
};

const ToleranceTypeName kToleranceTypes[] = {
    {"straightness", XCAFDimTolObjects_GeomToleranceType_Straightness},
    {"flatness", XCAFDimTolObjects_GeomToleranceType_Flatness},
    {"circularity", XCAFDimTolObjects_GeomToleranceType_CircularityOrRoundness},
    {"cylindricity", XCAFDimTolObjects_GeomToleranceType_Cylindricity},
    {"profileOfLine", XCAFDimTolObjects_GeomToleranceType_ProfileOfLine},
    {"profileOfSurface", XCAFDimTolObjects_GeomToleranceType_ProfileOfSurface},
    {"parallelism", XCAFDimTolObjects_GeomToleranceType_Parallelism},
    {"perpendicularity", XCAFDimTolObjects_GeomToleranceType_Perpendicularity},
    {"angularity", XCAFDimTolObjects_GeomToleranceType_Angularity},
    {"position", XCAFDimTolObjects_GeomToleranceType_Position},
    {"concentricity", XCAFDimTolObjects_GeomToleranceType_Concentricity},
    {"coaxiality", XCAFDimTolObjects_GeomToleranceType_Coaxiality},
    {"symmetry", XCAFDimTolObjects_GeomToleranceType_Symmetry},
    {"circularRunout", XCAFDimTolObjects_GeomToleranceType_CircularRunout},
    {"totalRunout", XCAFDimTolObjects_GeomToleranceType_TotalRunout},
};

// ISO 286 fundamental deviations as XCAF form variances (upper case; shafts are the same letters
// in lower case).
struct FormVarianceName {
  const char* letters;
  XCAFDimTolObjects_DimensionFormVariance variance;
};

const FormVarianceName kFormVariances[] = {
    {"A", XCAFDimTolObjects_DimensionFormVariance_A},
    {"B", XCAFDimTolObjects_DimensionFormVariance_B},
    {"C", XCAFDimTolObjects_DimensionFormVariance_C},
    {"CD", XCAFDimTolObjects_DimensionFormVariance_CD},
    {"D", XCAFDimTolObjects_DimensionFormVariance_D},
    {"E", XCAFDimTolObjects_DimensionFormVariance_E},
    {"EF", XCAFDimTolObjects_DimensionFormVariance_EF},
    {"F", XCAFDimTolObjects_DimensionFormVariance_F},
    {"FG", XCAFDimTolObjects_DimensionFormVariance_FG},
    {"G", XCAFDimTolObjects_DimensionFormVariance_G},
    {"H", XCAFDimTolObjects_DimensionFormVariance_H},
    {"JS", XCAFDimTolObjects_DimensionFormVariance_JS},
    {"J", XCAFDimTolObjects_DimensionFormVariance_J},
    {"K", XCAFDimTolObjects_DimensionFormVariance_K},
    {"M", XCAFDimTolObjects_DimensionFormVariance_M},
    {"N", XCAFDimTolObjects_DimensionFormVariance_N},
    {"P", XCAFDimTolObjects_DimensionFormVariance_P},
    {"R", XCAFDimTolObjects_DimensionFormVariance_R},
    {"S", XCAFDimTolObjects_DimensionFormVariance_S},
    {"T", XCAFDimTolObjects_DimensionFormVariance_T},
    {"U", XCAFDimTolObjects_DimensionFormVariance_U},
    {"V", XCAFDimTolObjects_DimensionFormVariance_V},
    {"X", XCAFDimTolObjects_DimensionFormVariance_X},
    {"Y", XCAFDimTolObjects_DimensionFormVariance_Y},
    {"ZA", XCAFDimTolObjects_DimensionFormVariance_ZA},
    {"ZB", XCAFDimTolObjects_DimensionFormVariance_ZB},
    {"ZC", XCAFDimTolObjects_DimensionFormVariance_ZC},
    {"Z", XCAFDimTolObjects_DimensionFormVariance_Z},
};

struct GradeName {
  const char* digits;
  XCAFDimTolObjects_DimensionGrade grade;
};

const GradeName kGrades[] = {
    {"01", XCAFDimTolObjects_DimensionGrade_IT01}, {"0", XCAFDimTolObjects_DimensionGrade_IT0},
    {"1", XCAFDimTolObjects_DimensionGrade_IT1},   {"2", XCAFDimTolObjects_DimensionGrade_IT2},
    {"3", XCAFDimTolObjects_DimensionGrade_IT3},   {"4", XCAFDimTolObjects_DimensionGrade_IT4},
    {"5", XCAFDimTolObjects_DimensionGrade_IT5},   {"6", XCAFDimTolObjects_DimensionGrade_IT6},
    {"7", XCAFDimTolObjects_DimensionGrade_IT7},   {"8", XCAFDimTolObjects_DimensionGrade_IT8},
    {"9", XCAFDimTolObjects_DimensionGrade_IT9},   {"10", XCAFDimTolObjects_DimensionGrade_IT10},
    {"11", XCAFDimTolObjects_DimensionGrade_IT11}, {"12", XCAFDimTolObjects_DimensionGrade_IT12},
    {"13", XCAFDimTolObjects_DimensionGrade_IT13}, {"14", XCAFDimTolObjects_DimensionGrade_IT14},
    {"15", XCAFDimTolObjects_DimensionGrade_IT15}, {"16", XCAFDimTolObjects_DimensionGrade_IT16},
    {"17", XCAFDimTolObjects_DimensionGrade_IT17}, {"18", XCAFDimTolObjects_DimensionGrade_IT18},
};

std::string upperAscii(std::string s) {
  for (char& c : s) {
    if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
  }
  return s;
}

std::string lowerAscii(std::string s) {
  for (char& c : s) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return s;
}

// "H7", "js6", "g6" → variance + grade (case is ignored; hole or shaft is the caller's).
bool parseFitClass(const std::string& text, XCAFDimTolObjects_DimensionFormVariance& variance,
                   XCAFDimTolObjects_DimensionGrade& grade) {
  size_t split = 0;
  while (split < text.size() && ((text[split] >= 'A' && text[split] <= 'Z') ||
                                 (text[split] >= 'a' && text[split] <= 'z'))) {
    ++split;
  }
  const std::string letters = upperAscii(text.substr(0, split));
  const std::string digits = text.substr(split);
  bool haveVariance = false;
  for (const FormVarianceName& f : kFormVariances) {
    if (letters == f.letters) {
      variance = f.variance;
      haveVariance = true;
      break;
    }
  }
  if (!haveVariance) return false;
  for (const GradeName& g : kGrades) {
    if (digits == g.digits) {
      grade = g.grade;
      return true;
    }
  }
  return false;
}

std::string fitClassText(bool hole, XCAFDimTolObjects_DimensionFormVariance variance,
                         XCAFDimTolObjects_DimensionGrade grade) {
  std::string letters;
  for (const FormVarianceName& f : kFormVariances) {
    if (f.variance == variance) letters = f.letters;
  }
  std::string digits;
  for (const GradeName& g : kGrades) {
    if (g.grade == grade) digits = g.digits;
  }
  if (letters.empty() || digits.empty()) return std::string();
  return (hole ? letters : lowerAscii(letters)) + digits;
}

// Contracts RefPoint.
const char* const kRefPoints[] = {"self", "center", "axis", "start", "end", "mid", "min", "max"};

bool isRefPoint(const std::string& s) {
  for (const char* p : kRefPoints) {
    if (s == p) return true;
  }
  return false;
}

// Wren's own descriptions on a dimension (written by exportStepPmi) and the CAx-IF 'dimensional
// note' (basic = 'theoretical', reference = 'auxiliary').
constexpr const char* kWrenPointsDescription = "wren measured points";
constexpr const char* kWrenFormDescription = "wren dimension form";
constexpr const char* kDimensionalNote = "dimensional note";

// A value as people write it in a message (0.05, not 0.050000000000000003).
std::string shortNumber(double v) {
  char buf[32];
  std::snprintf(buf, sizeof buf, "%.6g", v);
  return buf;
}

std::string hasciiText(const occ::handle<TCollection_HAsciiString>& s) {
  if (s.IsNull()) return std::string();
  return std::string(s->ToCString());
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

struct PmiExportReportData {
  int exported = 0;
  std::vector<std::pair<std::string, std::string>> skipped;  // annotation id, reason
  std::vector<std::pair<std::string, std::string>> notes;    // annotation id, note
};

// What the XCAF writer cannot express, completed in the STEP model after transfer, by
// annotation id (the id names the dimension's and tolerance's shape aspect).
struct PmiStepFixups {
  std::map<std::string, gp_Dir> orientation;  // linear distance → measuring direction
  std::map<std::string, double> projected;    // tolerance → projected zone height, mm
  std::set<std::string> allAround;            // tolerance → all around
};

struct PmiExportContext {
  const std::vector<ExportItem>& bodies;
  StepDocument& doc;
  occ::handle<XCAFDoc_DimTolTool> dimTol;
  bool presentation = true;
  std::map<std::string, std::string> datumOwner;  // datum label → annotation id
  PmiStepFixups fixups;
};

struct PmiTargetInput {
  TDF_Label label;
  TopoDS_Shape shape;
};

struct PmiPresentationInput {
  bool present = false;
  gp_Ax2 plane;
  TopoDS_Shape shape;  // null when nothing survived (nothing to draw)
  std::string note;    // what could not be written
};

double pmiNumber(const Json& obj, const char* key, const char* what) {
  const Json* v = obj.get(key);
  if (v == nullptr || !v->isNumber() || !std::isfinite(v->number)) {
    skipPmi(std::string(what) + " needs a finite number '" + key + "'");
  }
  return v->number;
}

int pmiInteger(const Json& obj, const char* key, const char* what) {
  const double v = pmiNumber(obj, key, what);
  if (std::floor(v) != v || std::fabs(v) > 2.0e9) {
    skipPmi(std::string(what) + " needs an integer '" + key + "'");
  }
  return static_cast<int>(v);
}

gp_XYZ pmiVec3(const Json& v, const char* what) {
  if (!v.isArray() || v.array.size() != 3) skipPmi(std::string(what) + " must be [x, y, z]");
  double xyz[3];
  for (size_t i = 0; i < 3; ++i) {
    const Json& c = *v.array[i];
    if (!c.isNumber() || !std::isfinite(c.number)) {
      skipPmi(std::string(what) + " must hold finite numbers");
    }
    xyz[i] = c.number;
  }
  return gp_XYZ(xyz[0], xyz[1], xyz[2]);
}

gp_XYZ pmiVec3Field(const Json& obj, const char* key, const char* what) {
  const Json* v = obj.get(key);
  if (v == nullptr) skipPmi(std::string(what) + "." + key + " is missing");
  return pmiVec3(*v, (std::string(what) + "." + key).c_str());
}

PmiTargetInput resolvePmiTarget(PmiExportContext& ctx, const Json& target) {
  if (!target.isObject()) skipPmi("a target is not an object");
  const int body = pmiInteger(target, "body", "a target");
  const std::string kind = optString(target, "kind", "");
  const int index = pmiInteger(target, "index", "a target");
  if (body < 0 || body >= static_cast<int>(ctx.bodies.size())) {
    skipPmi("unresolved target: body " + std::to_string(body) + " is not part of this export");
  }
  const ExportItem& item = ctx.bodies[static_cast<size_t>(body)];
  const Topo& topo = item.record->topo();
  const ShapeMap* map = kind == "face"     ? &topo.faces
                        : kind == "edge"   ? &topo.edges
                        : kind == "vertex" ? &topo.vertices
                                           : nullptr;
  if (map == nullptr) skipPmi("unresolved target: unknown kind '" + kind + "'");
  if (index < 1 || index > map->Extent()) {
    skipPmi("unresolved target: " + kind + " " + std::to_string(index) + " does not exist on '" +
            item.name + "' (" + std::to_string(map->Extent()) + " " + kind + "s)");
  }
  const TopoDS_Shape sub = map->FindKey(index);
  TDF_Label owner = ctx.doc.bodyLabels[static_cast<size_t>(body)];
  TopoDS_Shape local = sub;
  // A located body is stored as a reference to its unlocated definition (XCAFDoc_ShapeTool::
  // addShape); sub-shape labels live on the definition, in its coordinates.
  TDF_Label referred;
  if (XCAFDoc_ShapeTool::IsReference(owner) && XCAFDoc_ShapeTool::GetReferredShape(owner, referred)) {
    local = sub.Moved(item.record->shape.Location().Inverted());
    owner = referred;
  }
  TDF_Label subLabel;
  ctx.doc.shapes->AddSubShape(owner, local, subLabel);  // false when it already exists
  if (subLabel.IsNull()) {
    skipPmi("unresolved target: " + kind + " " + std::to_string(index) + " of '" + item.name +
            "' could not be attached in the STEP document");
  }
  return {subLabel, sub};
}

std::vector<PmiTargetInput> resolvePmiTargets(PmiExportContext& ctx, const Json& item) {
  const Json* targets = item.get("targets");
  if (targets == nullptr || !targets->isArray() || targets->array.empty()) {
    skipPmi("unresolved target: the annotation has no targets");
  }
  std::vector<PmiTargetInput> out;
  for (const JsonPtr& t : targets->array) out.push_back(resolvePmiTarget(ctx, *t));
  return out;
}

// One polyline as one edge on a degree-1 B-spline: OCCT's presentation writer turns it into one
// tessellated curve strip whose points are exactly the poles (STEPCAFControl_GDTProperty::
// GetTessellation), so the polyline survives the round trip as drawn.
TopoDS_Edge polylineEdge(const std::vector<gp_Pnt>& pts) {
  const int n = static_cast<int>(pts.size());
  NCollection_Array1<gp_Pnt> poles(1, n);
  NCollection_Array1<double> knots(1, n);
  NCollection_Array1<int> mults(1, n);
  double t = 0.0;
  for (int i = 1; i <= n; ++i) {
    if (i > 1) t += pts[static_cast<size_t>(i - 1)].Distance(pts[static_cast<size_t>(i - 2)]);
    poles(i) = pts[static_cast<size_t>(i - 1)];
    knots(i) = t;
    mults(i) = (i == 1 || i == n) ? 2 : 1;
  }
  occ::handle<Geom_BSplineCurve> curve = new Geom_BSplineCurve(poles, knots, mults, 1, false);
  BRepBuilderAPI_MakeEdge maker(curve);
  if (!maker.IsDone()) skipPmi("a presentation polyline could not be built");
  return maker.Edge();
}

PmiPresentationInput parsePmiPresentation(const Json& item) {
  PmiPresentationInput out;
  const Json* p = item.get("presentation");
  if (p == nullptr || p->kind == Json::Kind::Null) return out;
  if (!p->isObject()) skipPmi("presentation must be an object");
  const Json* plane = p->get("plane");
  if (plane == nullptr || !plane->isObject()) skipPmi("presentation.plane is missing");
  const gp_XYZ origin = pmiVec3Field(*plane, "origin", "presentation.plane");
  const gp_XYZ x = pmiVec3Field(*plane, "x", "presentation.plane");
  const gp_XYZ normal = pmiVec3Field(*plane, "normal", "presentation.plane");
  if (x.Modulus() < 1e-12 || normal.Modulus() < 1e-12) {
    skipPmi("presentation.plane axes must be non-zero vectors");
  }
  const gp_Dir nd(normal);
  const gp_Dir xd(x);
  if (nd.IsParallel(xd, 1e-9)) skipPmi("presentation.plane.x must not be parallel to its normal");
  out.plane = gp_Ax2(gp_Pnt(origin), nd, xd);
  const Json* lines = p->get("polylines");
  if (lines == nullptr || !lines->isArray()) skipPmi("presentation.polylines must be an array");
  BRep_Builder builder;
  TopoDS_Compound compound;
  builder.MakeCompound(compound);
  int edges = 0;
  for (const JsonPtr& line : lines->array) {
    if (!line->isArray()) skipPmi("a presentation polyline is not an array of points");
    std::vector<gp_Pnt> pts;
    for (const JsonPtr& v : line->array) {
      const gp_Pnt q(pmiVec3(*v, "a presentation point"));
      if (pts.empty() || pts.back().Distance(q) > 1e-9) pts.push_back(q);
    }
    if (pts.size() < 2) continue;  // a dot draws nothing
    builder.Add(compound, polylineEdge(pts));
    ++edges;
  }
  // v2 filled areas: one face holding only a triangulation, which OCCT's writer turns into a
  // complex_triangulated_surface_set (STEPCAFControl_GDTProperty::GetTessellation).
  int faces = 0;
  const Json* tris = p->get("triangles");
  if (tris != nullptr && tris->kind != Json::Kind::Null) {
    if (!tris->isArray() || tris->array.size() % 3 != 0) {
      skipPmi("presentation.triangles must hold three points per triangle");
    }
    std::vector<gp_Pnt> pts;
    for (const JsonPtr& v : tris->array) pts.emplace_back(pmiVec3(*v, "a presentation triangle point"));
    std::vector<int> keep;  // first point of each non-degenerate triangle
    for (size_t t = 0; t + 2 < pts.size(); t += 3) {
      const gp_Vec n = gp_Vec(pts[t], pts[t + 1]).Crossed(gp_Vec(pts[t], pts[t + 2]));
      if (n.Magnitude() > 1e-18) keep.push_back(static_cast<int>(t));
    }
    if (!keep.empty() && edges == 0) {
      // The writer's tessellated set always starts with the curve set; without a curve it
      // would write a null item.
      out.note = "filled presentation areas are written only with at least one polyline";
    } else if (!keep.empty()) {
      const int nodes = static_cast<int>(keep.size()) * 3;
      occ::handle<Poly_Triangulation> mesh =
          new Poly_Triangulation(nodes, static_cast<int>(keep.size()), false);
      for (size_t k = 0; k < keep.size(); ++k) {
        const int base = static_cast<int>(k) * 3;
        for (int c = 0; c < 3; ++c) {
          mesh->SetNode(base + c + 1, pts[static_cast<size_t>(keep[k] + c)]);
        }
        mesh->SetTriangle(static_cast<int>(k) + 1, Poly_Triangle(base + 1, base + 2, base + 3));
      }
      TopoDS_Face face;
      builder.MakeFace(face, mesh);
      builder.Add(compound, face);
      ++faces;
    }
  }
  out.present = true;
  if (edges > 0 || faces > 0) out.shape = compound;
  return out;
}

// Plane, text point and presentation for any XCAF GD&T object (they share these setters).
template <typename Object>
void applyPmiPresentation(const PmiExportContext& ctx, const PmiPresentationInput& prs,
                          const std::string& annotationId, const occ::handle<Object>& object) {
  if (!ctx.presentation || !prs.present) return;
  object->SetPlane(prs.plane);
  // The writer stores the text point as the annotation plane's origin; keep it the plane origin.
  object->SetPointTextAttach(prs.plane.Location());
  if (!prs.shape.IsNull()) {
    object->SetPresentation(prs.shape, new TCollection_HAsciiString(annotationId.c_str()));
  }
}

void nameGdtLabel(const TDF_Label& label, const std::string& annotationId) {
  // writeShapeAspect names the shape aspect after the label name's first space.
  const std::string text = "PMI " + annotationId;
  TDataStd_Name::Set(label, TCollection_ExtendedString(text.c_str(), true));
}

NCollection_Sequence<TDF_Label> labelSequence(const std::vector<PmiTargetInput>& targets,
                                              size_t from, size_t to) {
  NCollection_Sequence<TDF_Label> seq;
  for (size_t i = from; i < to && i < targets.size(); ++i) seq.Append(targets[i].label);
  return seq;
}

void exportPmiDatum(PmiExportContext& ctx, const Json& item, const std::string& id) {
  const std::string label = optString(item, "label", "");
  if (label.empty()) skipPmi("the datum has no label");
  if (label.size() > 8) skipPmi("datum label '" + label + "' is longer than 8 characters");
  auto owner = ctx.datumOwner.find(label);
  if (owner != ctx.datumOwner.end()) {
    skipPmi("datum " + label + " is already defined by annotation " + owner->second);
  }
  const std::vector<PmiTargetInput> targets = resolvePmiTargets(ctx, item);
  const PmiPresentationInput prs = parsePmiPresentation(item);

  const TDF_Label datumL = ctx.dimTol->AddDatum();
  occ::handle<XCAFDoc_Datum> attr = XCAFDoc_Datum::Set(datumL);
  occ::handle<XCAFDimTolObjects_DatumObject> object = new XCAFDimTolObjects_DatumObject();
  object->SetName(new TCollection_HAsciiString(label.c_str()));
  applyPmiPresentation(ctx, prs, id, object);
  attr->SetObject(object);
  ctx.dimTol->SetDatum(labelSequence(targets, 0, targets.size()), datumL);
  ctx.datumOwner.emplace(label, id);
}

void exportPmiDimension(PmiExportContext& ctx, const Json& item, const std::string& id,
                        PmiExportReportData& report) {
  const std::string type = optString(item, "type", "");
  const std::vector<PmiTargetInput> targets = resolvePmiTargets(ctx, item);
  const double value = pmiNumber(item, "value", "the dimension");
  if (value < 0) skipPmi("the dimension value is negative");

  XCAFDimTolObjects_DimensionType xType = XCAFDimTolObjects_DimensionType_Location_None;
  bool twoSided = false;  // dimensional location: first target(s) → second target
  if (type == "linearDistance") {
    if (targets.size() != 2) skipPmi("a linear distance needs exactly two targets");
    xType = XCAFDimTolObjects_DimensionType_Location_LinearDistance;
    twoSided = true;
  } else if (type == "angular") {
    if (targets.size() == 2) {
      xType = XCAFDimTolObjects_DimensionType_Location_Angular;
      twoSided = true;
    } else {
      xType = XCAFDimTolObjects_DimensionType_Size_Angular;
    }
  } else if (type == "linearDiameter") {
    xType = XCAFDimTolObjects_DimensionType_Size_Diameter;
  } else if (type == "linearRadius") {
    xType = XCAFDimTolObjects_DimensionType_Size_Radius;
  } else if (type == "size") {
    xType = XCAFDimTolObjects_DimensionType_Size_Thickness;
  } else if (type == "curveLength") {
    xType = XCAFDimTolObjects_DimensionType_Size_CurveLength;
  } else {
    skipPmi("unsupported dimension type '" + type + "'");
  }

  // Tolerance: plus/minus deviations or one ISO 286 class.
  bool deviation = false;
  double upper = 0.0;
  double lower = 0.0;
  bool fit = false;
  bool fitHole = false;
  XCAFDimTolObjects_DimensionFormVariance variance = XCAFDimTolObjects_DimensionFormVariance_None;
  XCAFDimTolObjects_DimensionGrade grade = XCAFDimTolObjects_DimensionGrade_IT01;
  const Json* tol = item.get("tolerance");
  if (tol != nullptr && tol->kind != Json::Kind::Null) {
    if (!tol->isObject()) skipPmi("the dimension tolerance must be an object");
    const std::string kind = optString(*tol, "kind", "");
    if (kind == "deviation") {
      upper = pmiNumber(*tol, "upper", "the deviation");
      lower = pmiNumber(*tol, "lower", "the deviation");
      if (upper < lower) skipPmi("the upper deviation is below the lower one");
      deviation = true;
    } else if (kind == "fit") {
      const std::string hole = optString(*tol, "hole", "");
      const std::string shaft = optString(*tol, "shaft", "");
      if (hole.empty() && shaft.empty()) skipPmi("the fit names neither a hole nor a shaft class");
      if (!hole.empty() && !shaft.empty()) {
        // XCAF holds one class of tolerance per dimension: keep the one of the feature itself.
        bool decided = false;
        if (targets[0].shape.ShapeType() == TopAbs_FACE) {
          const TopoDS_Face face = TopoDS::Face(targets[0].shape);
          const BRepAdaptor_Surface surface(face, false);
          if (surface.GetType() == GeomAbs_Cylinder) {
            fitHole = concaveQuadric(surface.Cylinder().Position(), face);
            decided = true;
          }
        }
        if (!decided) {
          skipPmi("a fit " + hole + "/" + shaft +
                  " needs a cylindrical target to choose the class STEP can hold");
        }
        report.notes.emplace_back(
            id, std::string("STEP holds one class of tolerance per dimension: wrote ") +
                    (fitHole ? hole : shaft) + ", not " + (fitHole ? shaft : hole));
      } else {
        fitHole = !hole.empty();
      }
      const std::string cls = fitHole ? hole : shaft;
      if (!parseFitClass(cls, variance, grade)) skipPmi("unknown ISO 286 class '" + cls + "'");
      fit = true;
    } else {
      skipPmi("unknown dimension tolerance kind '" + kind + "'");
    }
  }
  const PmiPresentationInput prs = parsePmiPresentation(item);
  // v2: measuring direction, measured points, basic/reference, ordinate, spherical.
  bool hasDirection = false;
  gp_Dir direction;
  const Json* dirField = item.get("direction");
  if (dirField != nullptr && dirField->kind != Json::Kind::Null) {
    const gp_XYZ d = pmiVec3(*dirField, "the dimension direction");
    if (d.Modulus() < 1e-12) skipPmi("the dimension direction must be a non-zero vector");
    direction = gp_Dir(d);
    hasDirection = true;
  }
  std::vector<std::string> at;
  const Json* atField = item.get("at");
  if (atField != nullptr && atField->kind != Json::Kind::Null) {
    if (!atField->isArray()) skipPmi("the dimension's at must be an array");
    for (const JsonPtr& q : atField->array) {
      if (!q->isString() || !isRefPoint(q->string)) skipPmi("unknown point qualifier in at");
      at.push_back(q->string);
    }
    if (at.size() > targets.size()) skipPmi("the dimension has more point qualifiers than targets");
  }
  bool measuredPoints = false;
  for (const std::string& q : at) measuredPoints = measuredPoints || q != "self";
  const std::string qualifier = optString(item, "qualifier", "");
  if (!qualifier.empty() && qualifier != "basic" && qualifier != "reference") {
    skipPmi("unknown dimension qualifier '" + qualifier + "'");
  }
  const bool ordinate = boolOption(item, "ordinate", false);
  const bool spherical = boolOption(item, "spherical", false);
  if (ordinate && (type != "linearDistance" || !hasDirection)) {
    skipPmi("an ordinate is a linearDistance with a direction");
  }
  // Every input is valid from here on: notes and fixups belong to a written dimension.
  if (spherical) {
    if (type == "linearDiameter") {
      xType = XCAFDimTolObjects_DimensionType_Size_SphericalDiameter;
    } else if (type == "linearRadius") {
      xType = XCAFDimTolObjects_DimensionType_Size_SphericalRadius;
    } else {
      report.notes.emplace_back(id, "spherical applies to a radius or a diameter; not written");
    }
  }
  if (hasDirection && type != "linearDistance") {
    report.notes.emplace_back(id, "a measuring direction is written for a linear distance only");
  }
  if (!qualifier.empty() && (deviation || fit)) {
    report.notes.emplace_back(id, "a " + qualifier + " dimension has no tolerance: the tolerance is not written");
    deviation = false;
    fit = false;
  }
  if (measuredPoints) {
    report.notes.emplace_back(id, "STEP has no point qualifiers OCCT can write: the measured points are a "
                                  "Wren description; other systems measure between the faces");
  }
  if (ordinate) {
    report.notes.emplace_back(id, "STEP has no ordinate dimension: written as a linear distance with a "
                                  "Wren description; other systems read a linear distance");
  }
  if (!prs.note.empty()) report.notes.emplace_back(id, prs.note);

  const TDF_Label dimL = ctx.dimTol->AddDimension();
  nameGdtLabel(dimL, id);
  occ::handle<XCAFDoc_Dimension> attr = XCAFDoc_Dimension::Set(dimL);
  occ::handle<XCAFDimTolObjects_DimensionObject> object = new XCAFDimTolObjects_DimensionObject();
  object->SetType(xType);
  object->SetValue(value);
  if (deviation) {
    object->SetUpperTolValue(upper);
    object->SetLowerTolValue(-lower);  // XCAF keeps the lower deviation as a magnitude
  }
  if (fit) object->SetClassOfTolerance(fitHole, variance, grade);
  // Written as descriptive_representation_items of the dimension's representation, which the
  // reader returns as descriptions: the CAx-IF 'dimensional note' for basic ('theoretical') and
  // reference ('auxiliary'), Wren's own for the measured points and the ordinate form.
  auto describe = [&](const char* key, const std::string& text) {
    object->AddDescription(new TCollection_HAsciiString(text.c_str()), new TCollection_HAsciiString(key));
  };
  if (qualifier == "basic") describe(kDimensionalNote, "theoretical");
  if (qualifier == "reference") describe(kDimensionalNote, "auxiliary");
  if (measuredPoints) {
    std::string list;
    for (size_t i = 0; i < at.size(); ++i) list += (i > 0 ? "," : "") + at[i];
    describe(kWrenPointsDescription, list);
  }
  if (ordinate) describe(kWrenFormDescription, "ordinate");
  // OCCT 8.0.1 writes a direction only for its own oriented type (an unnamed
  // dimensional_location): added to the 'linear distance' after transfer instead.
  if (hasDirection && type == "linearDistance") ctx.fixups.orientation[id] = direction;
  applyPmiPresentation(ctx, prs, id, object);
  attr->SetObject(object);
  if (twoSided) {
    ctx.dimTol->SetDimension(labelSequence(targets, 0, 1), labelSequence(targets, 1, 2), dimL);
  } else {
    NCollection_Sequence<TDF_Label> none;
    ctx.dimTol->SetDimension(labelSequence(targets, 0, targets.size()), none, dimL);
  }
}

void exportPmiTolerance(PmiExportContext& ctx, const Json& item, const std::string& id,
                        PmiExportReportData& report) {
  const std::string type = optString(item, "type", "");
  XCAFDimTolObjects_GeomToleranceType xType = XCAFDimTolObjects_GeomToleranceType_None;
  for (const ToleranceTypeName& t : kToleranceTypes) {
    if (type == t.name) xType = t.type;
  }
  if (xType == XCAFDimTolObjects_GeomToleranceType_None) {
    skipPmi("unsupported tolerance type '" + type + "'");
  }
  const std::vector<PmiTargetInput> targets = resolvePmiTargets(ctx, item);
  const double value = pmiNumber(item, "value", "the tolerance");
  if (!(value > 0)) skipPmi("the tolerance zone must be greater than zero");
  const Json* diameter = item.get("diameter");
  const bool isDiameter = diameter != nullptr && diameter->kind == Json::Kind::Bool && diameter->boolean;
  auto material = [](const std::string& m, const std::string& what) {
    if (m.empty()) return 0;
    if (m == "M") return 1;
    if (m == "L") return 2;
    skipPmi("unknown material modifier '" + m + "' on " + what);
  };
  const int zoneMaterial = material(optString(item, "material", ""), "the tolerance zone");

  struct DatumRef {
    std::string label;
    int material;
  };
  std::vector<DatumRef> refs;
  const Json* datums = item.get("datums");
  if (datums != nullptr && datums->kind != Json::Kind::Null) {
    if (!datums->isArray()) skipPmi("datums must be an array");
    if (datums->array.size() > 3) skipPmi("a datum reference frame holds at most three datums");
    for (const JsonPtr& d : datums->array) {
      if (!d->isObject()) skipPmi("a datum reference is not an object");
      const std::string label = optString(*d, "label", "");
      if (label.empty()) skipPmi("a datum reference has no label");
      if (ctx.datumOwner.find(label) == ctx.datumOwner.end()) {
        skipPmi("references datum " + label + ", which is not part of this export");
      }
      refs.push_back({label, material(optString(*d, "material", ""), "datum " + label)});
    }
  }
  const PmiPresentationInput prs = parsePmiPresentation(item);
  // v2: spherical zone, zone modifiers, projected and unequal zones, all around. Notes are
  // collected and reported only once every input is valid.
  std::vector<std::string> notes;
  const bool spherical = boolOption(item, "spherical", false);
  if (spherical && !isDiameter) {
    notes.push_back("a spherical zone is a diameter zone (SØ): spherical without diameter is not written");
  }
  std::vector<XCAFDimTolObjects_GeomToleranceModif> modifiers;
  const Json* mods = item.get("modifiers");
  if (mods != nullptr && mods->kind != Json::Kind::Null) {
    if (!mods->isArray()) skipPmi("modifiers must be an array");
    for (const JsonPtr& m : mods->array) {
      const std::string name = m->isString() ? m->string : std::string();
      XCAFDimTolObjects_GeomToleranceModif x;
      if (name == "freeState") {
        x = XCAFDimTolObjects_GeomToleranceModif_Free_State;
      } else if (name == "tangentPlane") {
        x = XCAFDimTolObjects_GeomToleranceModif_Tangent_Plane;
      } else if (name == "statistical") {
        x = XCAFDimTolObjects_GeomToleranceModif_Statistical_Tolerance;
      } else if (name == "combinedZone") {
        x = XCAFDimTolObjects_GeomToleranceModif_Common_Zone;
      } else if (name == "separateZones") {
        x = XCAFDimTolObjects_GeomToleranceModif_Separate_Requirement;
        notes.push_back("separate zones (SZ) are written as AP242's separate requirement, the closest "
                        "modifier");
      } else {
        skipPmi("unknown zone modifier '" + name + "'");
      }
      if (std::find(modifiers.begin(), modifiers.end(), x) == modifiers.end()) modifiers.push_back(x);
    }
  }
  double projected = 0.0;
  if (const Json* pr = item.get("projected"); pr != nullptr && pr->kind != Json::Kind::Null) {
    projected = pmiNumber(item, "projected", "the tolerance");
    if (!(projected > 0)) skipPmi("the projected zone height must be greater than zero");
  }
  if (const Json* un = item.get("unequal"); un != nullptr && un->kind != Json::Kind::Null) {
    const double unequal = pmiNumber(item, "unequal", "the tolerance");
    notes.push_back("OCCT 8.0.1 cannot write an unequally disposed zone: written without it (UZ " +
                    shortNumber(unequal) + ")");
  }
  const bool allAround = boolOption(item, "allAround", false);
  if (!prs.note.empty()) notes.push_back(prs.note);
  for (const std::string& n : notes) report.notes.emplace_back(id, n);

  const TDF_Label tolL = ctx.dimTol->AddGeomTolerance();
  nameGdtLabel(tolL, id);
  occ::handle<XCAFDoc_GeomTolerance> attr = XCAFDoc_GeomTolerance::Set(tolL);
  occ::handle<XCAFDimTolObjects_GeomToleranceObject> object =
      new XCAFDimTolObjects_GeomToleranceObject();
  object->SetType(xType);
  object->SetValue(value);
  if (isDiameter) {
    object->SetTypeOfValue(spherical ? XCAFDimTolObjects_GeomToleranceTypeValue_SphericalDiameter
                                     : XCAFDimTolObjects_GeomToleranceTypeValue_Diameter);
  }
  for (XCAFDimTolObjects_GeomToleranceModif m : modifiers) object->AddModifier(m);
  // OCCT 8.0.1's writer writes neither a projected zone nor all around: both are added to the
  // STEP model after transfer (applyPmiStepFixups), in the form its reader reads.
  if (projected > 0) ctx.fixups.projected[id] = projected;
  if (allAround) ctx.fixups.allAround.insert(id);
  if (zoneMaterial == 1) {
    object->SetMaterialRequirementModifier(XCAFDimTolObjects_GeomToleranceMatReqModif_M);
  } else if (zoneMaterial == 2) {
    object->SetMaterialRequirementModifier(XCAFDimTolObjects_GeomToleranceMatReqModif_L);
  }
  applyPmiPresentation(ctx, prs, id, object);
  attr->SetObject(object);
  ctx.dimTol->SetGeomTolerance(labelSequence(targets, 0, targets.size()), tolL);
  // One datum label per reference (its precedence and modifiers belong to this tolerance). The
  // writer emits each datum once, from the first label with that name: the datum item's own,
  // created in the first pass.
  for (size_t i = 0; i < refs.size(); ++i) {
    const TDF_Label refL = ctx.dimTol->AddDatum();
    occ::handle<XCAFDoc_Datum> refAttr = XCAFDoc_Datum::Set(refL);
    occ::handle<XCAFDimTolObjects_DatumObject> ref = new XCAFDimTolObjects_DatumObject();
    ref->SetName(new TCollection_HAsciiString(refs[i].label.c_str()));
    ref->SetPosition(static_cast<int>(i) + 1);
    if (refs[i].material == 1) {
      ref->AddModifier(XCAFDimTolObjects_DatumSingleModif_MaximumMaterialRequirement);
    } else if (refs[i].material == 2) {
      ref->AddModifier(XCAFDimTolObjects_DatumSingleModif_LeastMaterialRequirement);
    }
    refAttr->SetObject(ref);
    ctx.dimTol->SetDatumToGeomTol(refL, tolL);
  }
}

// Adds every item it can to the document; fills `report` and returns the ids written.
std::vector<std::string> addPmiToDocument(const std::vector<ExportItem>& bodies, StepDocument& doc,
                                          const Json& items, bool presentation,
                                          PmiExportReportData& report, PmiStepFixups& fixups) {
  PmiExportContext ctx{bodies, doc, XCAFDoc_DocumentTool::DimTolTool(doc.doc->Main()),
                       presentation, {}};
  std::vector<std::string> written;
  // Datums first: tolerances reference them, and the writer must meet each datum's own label
  // before the per-tolerance reference labels of the same name.
  for (int pass = 0; pass < 3; ++pass) {
    for (const JsonPtr& entry : items.array) {
      if (!entry->isObject()) raiseError("INVALID_INPUT", "PMI items must be objects");
      const Json& item = *entry;
      const Json* idField = item.get("annotationId");
      if (idField == nullptr || !idField->isString() || idField->string.empty()) {
        raiseError("INVALID_INPUT", "Every PMI item needs an annotationId");
      }
      const std::string& id = idField->string;
      const std::string kind = optString(item, "kind", "");
      const int itemPass = kind == "datum" ? 0 : kind == "dimension" ? 1 : kind == "tolerance" ? 2 : -1;
      if (itemPass == -1) {
        if (pass == 0) report.skipped.emplace_back(id, "unsupported PMI kind '" + kind + "'");
        continue;
      }
      if (itemPass != pass) continue;
      try {
        if (kind == "datum") {
          exportPmiDatum(ctx, item, id);
        } else if (kind == "dimension") {
          exportPmiDimension(ctx, item, id, report);
        } else {
          exportPmiTolerance(ctx, item, id, report);
        }
        written.push_back(id);
      } catch (const PmiSkip& skip) {
        report.skipped.emplace_back(id, skip.reason);
      } catch (const Standard_Failure& e) {
        const char* what = e.what();
        report.skipped.emplace_back(
            id, std::string("the geometry kernel failed on this annotation: ") +
                    (what != nullptr ? what : e.ExceptionType()));
      }
    }
  }
  report.exported = static_cast<int>(written.size());
  fixups = ctx.fixups;
  return written;
}

// The shape aspect the writer named after an annotation id (writeShapeAspect takes the GD&T
// label name after its first space, "PMI <id>").
bool namedFor(const occ::handle<StepRepr_ShapeAspect>& sa, const std::string& id) {
  return !sa.IsNull() && hasciiText(sa->Name()) == id;
}

// Completes the written STEP model with what OCCT 8.0.1's XCAF writer cannot express, in the form
// its reader (and the CAx-IF recommended practices) use; anything not found is noted.
void applyPmiStepFixups(const occ::handle<StepData_StepModel>& model, const PmiStepFixups& fixups,
                        PmiExportReportData& report) {
  if (model.IsNull()) return;
  // OCCT 8.0.1 (writeDGTsAP242) takes the presentation draughting model's context from the
  // dimensions it writes: with presentation but no dimension (a flatness alone, datums and
  // frames only) the model has none and Write fails. Use the context of the geometry the GD&T
  // is on, as the writer does for dimensions.
  occ::handle<StepRepr_RepresentationContext> gdtContext;
  for (int i = 1; i <= model->NbEntities() && gdtContext.IsNull(); ++i) {
    const occ::handle<StepAP242_GeometricItemSpecificUsage> gisu =
        occ::down_cast<StepAP242_GeometricItemSpecificUsage>(model->Value(i));
    if (!gisu.IsNull() && !gisu->UsedRepresentation().IsNull()) {
      gdtContext = gisu->UsedRepresentation()->ContextOfItems();
    }
  }
  for (int i = 1; i <= model->NbEntities() && !gdtContext.IsNull(); ++i) {
    const occ::handle<StepVisual_DraughtingModel> dm =
        occ::down_cast<StepVisual_DraughtingModel>(model->Value(i));
    if (!dm.IsNull() && dm->ContextOfItems().IsNull()) dm->SetContextOfItems(gdtContext);
  }
  // The same missing context makes the writer's GetUnit fall back to new units: tolerance values
  // written in mm are tagged SI_UNIT(.METRE.) (a 0.1 mm zone reads as 0.1 m elsewhere) and angles
  // get a plane angle unit named METRE. Relabel those measures with the context's own units.
  occ::handle<NCollection_HArray1<occ::handle<StepBasic_NamedUnit>>> contextUnits;
  if (const auto c1 = occ::down_cast<StepGeom_GeometricRepresentationContextAndGlobalUnitAssignedContext>(gdtContext);
      !c1.IsNull()) {
    contextUnits = c1->Units();
  } else if (const auto c2 = occ::down_cast<StepGeom_GeomRepContextAndGlobUnitAssCtxAndGlobUncertaintyAssCtx>(gdtContext);
             !c2.IsNull()) {
    contextUnits = c2->Units();
  }
  occ::handle<StepBasic_NamedUnit> lengthUnit;
  occ::handle<StepBasic_NamedUnit> angleUnit;
  std::set<const Standard_Transient*> ownUnits;
  if (!contextUnits.IsNull()) {
    for (int i = contextUnits->Lower(); i <= contextUnits->Upper(); ++i) {
      const occ::handle<StepBasic_NamedUnit>& u = contextUnits->Value(i);
      if (u.IsNull()) continue;
      ownUnits.insert(u.get());
      if (lengthUnit.IsNull() && (u->IsKind(STANDARD_TYPE(StepBasic_SiUnitAndLengthUnit)) ||
                                  u->IsKind(STANDARD_TYPE(StepBasic_ConversionBasedUnitAndLengthUnit)))) {
        lengthUnit = u;
      }
      if (angleUnit.IsNull() && (u->IsKind(STANDARD_TYPE(StepBasic_SiUnitAndPlaneAngleUnit)) ||
                                 u->IsKind(STANDARD_TYPE(StepBasic_ConversionBasedUnitAndPlaneAngleUnit)))) {
        angleUnit = u;
      }
    }
  }
  for (int i = 1; i <= model->NbEntities() && !lengthUnit.IsNull() && !angleUnit.IsNull(); ++i) {
    const occ::handle<Standard_Transient> e = model->Value(i);
    occ::handle<StepBasic_MeasureWithUnit> m = occ::down_cast<StepBasic_MeasureWithUnit>(e);
    if (m.IsNull()) {
      const occ::handle<StepRepr_ReprItemAndMeasureWithUnit> ri =
          occ::down_cast<StepRepr_ReprItemAndMeasureWithUnit>(e);
      if (!ri.IsNull()) m = ri->GetMeasureWithUnit();
    }
    if (m.IsNull() || m->UnitComponent().IsNull()) continue;
    const occ::handle<StepBasic_NamedUnit> u = m->UnitComponent().NamedUnit();
    if (u.IsNull() || ownUnits.count(u.get()) > 0) continue;
    StepBasic_Unit replacement;
    if (u->IsKind(STANDARD_TYPE(StepBasic_SiUnitAndPlaneAngleUnit))) {
      replacement.SetValue(angleUnit);
    } else if (u->IsKind(STANDARD_TYPE(StepBasic_SiUnitAndLengthUnit))) {
      replacement.SetValue(lengthUnit);
    } else {
      continue;
    }
    m->SetUnitComponent(replacement);
  }
  std::set<std::string> oriented;
  std::set<std::string> projected;
  std::set<std::string> allAround;
  const int count = model->NbEntities();  // entities added below are not visited
  for (int i = 1; i <= count; ++i) {
    const occ::handle<Standard_Transient> e = model->Value(i);
    // Measuring direction: an axis2_placement_3d 'orientation' in the dimension's
    // shape_dimension_representation, the direction as its ref_direction.
    const occ::handle<StepShape_DimensionalCharacteristicRepresentation> dcr =
        occ::down_cast<StepShape_DimensionalCharacteristicRepresentation>(e);
    if (!dcr.IsNull() && !dcr->Representation().IsNull()) {
      const occ::handle<StepShape_DimensionalLocation> loc =
          occ::down_cast<StepShape_DimensionalLocation>(dcr->Dimension().Value());
      if (loc.IsNull()) continue;
      for (const auto& [id, dir] : fixups.orientation) {
        if (!namedFor(loc->RelatingShapeAspect(), id) || oriented.count(id) > 0) continue;
        const gp_Ax2 frame(gp::Origin(), dir);  // any axis normal to the direction
        occ::handle<StepGeom_Direction> axis = new StepGeom_Direction();
        axis->Init3D(new TCollection_HAsciiString(), frame.XDirection().X(), frame.XDirection().Y(),
                     frame.XDirection().Z());
        occ::handle<StepGeom_Direction> ref = new StepGeom_Direction();
        ref->Init3D(new TCollection_HAsciiString(), dir.X(), dir.Y(), dir.Z());
        GeomToStep_MakeCartesianPoint origin(gp::Origin(), 1.0);
        occ::handle<StepGeom_Axis2Placement3d> placement = new StepGeom_Axis2Placement3d();
        placement->Init(new TCollection_HAsciiString("orientation"), origin.Value(), true, axis, true, ref);
        const occ::handle<StepShape_ShapeDimensionRepresentation> sdr = dcr->Representation();
        const int n = sdr->NbItems();
        occ::handle<NCollection_HArray1<occ::handle<StepRepr_RepresentationItem>>> items =
            new NCollection_HArray1<occ::handle<StepRepr_RepresentationItem>>(1, n + 1);
        for (int k = 1; k <= n; ++k) items->SetValue(k, sdr->ItemsValue(k));
        items->SetValue(n + 1, placement);
        sdr->SetItems(items);
        model->AddWithRefs(axis);
        model->AddWithRefs(ref);
        model->AddWithRefs(origin.Value());
        model->AddWithRefs(placement);
        oriented.insert(id);
      }
      continue;
    }
    const occ::handle<StepDimTol_GeometricTolerance> tol =
        occ::down_cast<StepDimTol_GeometricTolerance>(e);
    if (tol.IsNull()) continue;
    const occ::handle<StepRepr_ShapeAspect> sa = tol->TolerancedShapeAspect().ShapeAspect();
    if (sa.IsNull()) continue;
    const std::string id = hasciiText(sa->Name());
    // Projected zone: a tolerance_zone of the tolerance with a projected_zone_definition.
    auto height = fixups.projected.find(id);
    if (height != fixups.projected.end() && projected.count(id) == 0) {
      occ::handle<StepBasic_MeasureWithUnit> magnitude =
          occ::down_cast<StepBasic_MeasureWithUnit>(tol->Magnitude());
      if (magnitude.IsNull()) {
        const occ::handle<StepRepr_ReprItemAndMeasureWithUnit> ri =
            occ::down_cast<StepRepr_ReprItemAndMeasureWithUnit>(tol->Magnitude());
        if (!ri.IsNull()) magnitude = ri->GetMeasureWithUnit();
      }
      occ::handle<StepDimTol_ToleranceZone> zone;
      for (int k = 1; k <= count && zone.IsNull(); ++k) {
        const occ::handle<StepDimTol_ToleranceZone> z =
            occ::down_cast<StepDimTol_ToleranceZone>(model->Value(k));
        if (z.IsNull()) continue;
        for (int t = 1; t <= z->NbDefiningTolerances(); ++t) {
          if (z->DefiningToleranceValue(t).Value().get() == tol.get()) zone = z;
        }
      }
      if (!magnitude.IsNull()) {
        if (zone.IsNull()) {
          occ::handle<StepDimTol_ToleranceZoneForm> form = new StepDimTol_ToleranceZoneForm();
          form->Init(new TCollection_HAsciiString("unknown"));
          occ::handle<NCollection_HArray1<StepDimTol_ToleranceZoneTarget>> targets =
              new NCollection_HArray1<StepDimTol_ToleranceZoneTarget>(1, 1);
          StepDimTol_ToleranceZoneTarget target;
          target.SetValue(tol);
          targets->SetValue(1, target);
          zone = new StepDimTol_ToleranceZone();
          zone->Init(new TCollection_HAsciiString(), new TCollection_HAsciiString(), sa->OfShape(),
                     StepData_LFalse, targets, form);
          // OCCT's shared lists for these classes miss members: add every entity itself (the
          // writer does the same for the zone form), or the file gets unknown references.
          model->AddWithRefs(form);
          model->AddWithRefs(zone);
        }
        occ::handle<StepBasic_MeasureValueMember> v = new StepBasic_MeasureValueMember();
        v->SetName("LENGTH_MEASURE");
        v->SetReal(height->second);
        occ::handle<StepBasic_LengthMeasureWithUnit> length = new StepBasic_LengthMeasureWithUnit();
        length->Init(v, magnitude->UnitComponent());
        occ::handle<StepDimTol_ProjectedZoneDefinition> definition =
            new StepDimTol_ProjectedZoneDefinition();
        definition->Init(zone, new NCollection_HArray1<occ::handle<StepRepr_ShapeAspect>>(), sa, length);
        model->AddWithRefs(length);
        model->AddWithRefs(definition);
        projected.insert(id);
      }
    }
    // All around: the tolerance applies to an all_around_shape_aspect composed of its faces.
    if (fixups.allAround.count(id) > 0 && allAround.count(id) == 0 &&
        !sa->IsKind(STANDARD_TYPE(StepRepr_AllAroundShapeAspect))) {
      occ::handle<StepRepr_AllAroundShapeAspect> around = new StepRepr_AllAroundShapeAspect();
      around->Init(new TCollection_HAsciiString(id.c_str()), new TCollection_HAsciiString("all around"),
                   sa->OfShape(), StepData_LFalse);
      occ::handle<StepRepr_ShapeAspectRelationship> member = new StepRepr_ShapeAspectRelationship();
      member->Init(new TCollection_HAsciiString(), false, nullptr, around, sa);
      tol->SetTolerancedShapeAspect(occ::handle<StepRepr_ShapeAspect>(around));
      model->AddWithRefs(around);
      model->AddWithRefs(member);
      allAround.insert(id);
    }
  }
  for (const auto& entry : fixups.orientation) {
    if (oriented.count(entry.first) == 0) {
      report.notes.emplace_back(entry.first, "the measuring direction could not be written");
    }
  }
  for (const auto& entry : fixups.projected) {
    if (projected.count(entry.first) == 0) {
      report.notes.emplace_back(entry.first, "the projected zone could not be written");
    }
  }
  for (const std::string& id : fixups.allAround) {
    if (allAround.count(id) == 0) report.notes.emplace_back(id, "all around could not be written");
  }
}

struct PmiExportOutcome {
  std::string path;
  PmiExportReportData report;
};

PmiExportOutcome exportStepWithPmi(const std::vector<ExportItem>& bodies, const Json& items,
                                   const Json& options) {
  if (!items.isArray()) raiseError("INVALID_INPUT", "PMI items must be a JSON array");
  const std::string schema = optString(options, "stepSchema", "AP242");
  if (schema != "AP242") {
    raiseError("INVALID_INPUT", "STEP PMI needs the AP242 schema, not " + schema,
               "Export with stepSchema AP242, or without model dimensions.");
  }
  bool presentation = true;
  if (const Json* pmi = options.get("pmi")) {
    if (pmi->isObject()) presentation = boolOption(*pmi, "presentation", true);
  }
  const DESTEP_Parameters params = stepWriteParameters(schema);
  PmiExportOutcome out;
  StepDocument doc = buildStepDocument(bodies);
  PmiStepFixups fixups;
  const std::vector<std::string> written =
      addPmiToDocument(bodies, doc, items, presentation, out.report, fixups);
  std::string failure;
  const size_t notesBefore = out.report.notes.size();
  try {
    out.path = writeStepDocument(doc.doc, params, [&](const occ::handle<StepData_StepModel>& model) {
      applyPmiStepFixups(model, fixups, out.report);
    });
    return out;
  } catch (const Standard_Failure& e) {
    const char* what = e.what();
    failure = std::string(e.ExceptionType()) + ": " + (what != nullptr ? what : "");
  } catch (const FacadeError& e) {
    failure = e.error().message;
  }
  // The writer failed with the GD&T in the document: write the geometry alone and report every
  // annotation as not exported, rather than failing the whole export.
  out.report.notes.resize(notesBefore);
  const StepDocument plain = buildStepDocument(bodies);
  out.path = writeStepDocument(plain.doc, params);
  for (const std::string& id : written) {
    out.report.skipped.emplace_back(
        id, "the STEP writer failed on the PMI (" + failure + "); the file holds geometry only");
  }
  out.report.exported = 0;
  return out;
}

std::string pmiExportReportJson(const PmiExportReportData& report) {
  std::string json = "{\"exported\":" + std::to_string(report.exported) + ",\"skipped\":[";
  for (size_t i = 0; i < report.skipped.size(); ++i) {
    if (i > 0) json.push_back(',');
    json += "{\"annotationId\":" + jsonString(report.skipped[i].first) +
            ",\"reason\":" + jsonString(report.skipped[i].second) + "}";
  }
  json += "],\"notes\":[";
  for (size_t i = 0; i < report.notes.size(); ++i) {
    if (i > 0) json.push_back(',');
    json += "{\"annotationId\":" + jsonString(report.notes[i].first) +
            ",\"note\":" + jsonString(report.notes[i].second) + "}";
  }
  json += "]}";
  return json;
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

// Issue severities (contracts PmiIssueSeverity).
constexpr const char* kLost = "lost";
constexpr const char* kApproximated = "approximated";
constexpr const char* kCosmetic = "cosmetic";

struct PmiImportContext {
  const std::vector<std::pair<TopoDS_Shape, std::string>>& bodies;
  std::vector<std::unique_ptr<Topo>> topo;
  std::vector<std::string> items;   // PmiImportItem JSON
  std::vector<std::string> issues;  // PmiImportIssue JSON
  // Radians per plane-angle unit of the file. OCCT 8.0.1 converts angular nominal values and
  // limits to degrees but leaves plus/minus deviations in the file's unit (their
  // measure_with_unit is not a plane_angle_measure_with_unit, and the unit context it builds for
  // them has a zero length factor), so the import converts them itself.
  double angleUnitRad = 1.0;
  bool angleUnitKnown = false;
  // The STEP model behind the XCAF document (whittle_pmi_step.cpp); invalid when unavailable.
  StepPmiModel* step = nullptr;
  std::vector<StepDimensionInfo> stepDims;
  std::vector<StepToleranceInfo> stepTols;
  occ::handle<TDocStd_Document> doc;
  bool docShapesLoaded = false;
  std::set<const TopoDS_TShape*> docShapes;
  int noValueLabels = 0;  // XCAF dimensions OCCT created without a value
};

// The file's plane-angle unit: a conversion-based one (degree, grad) when the file declares one,
// else the SI radian (with its prefix). False when conversion-based units disagree.
bool stepPlaneAngleUnit(STEPCAFControl_Reader& reader, double& radPerUnit) {
  const occ::handle<Interface_InterfaceModel> model = reader.ChangeReader().Model();
  if (model.IsNull()) return false;
  bool haveConversion = false;
  bool haveSi = false;
  double conversion = 0.0;
  double si = 0.0;
  for (int i = 1; i <= model->NbEntities(); ++i) {
    const occ::handle<Standard_Transient> entity = model->Value(i);
    if (entity.IsNull()) continue;
    const bool isConversion =
        entity->IsKind(STANDARD_TYPE(StepBasic_ConversionBasedUnitAndPlaneAngleUnit));
    const bool isSi = entity->IsKind(STANDARD_TYPE(StepBasic_SiUnitAndPlaneAngleUnit));
    if (!isConversion && !isSi) continue;
    STEPConstruct_UnitContext units;
    if (units.ComputeFactors(occ::down_cast<StepBasic_NamedUnit>(entity)) != 0 ||
        !units.PlaneAngleDone()) {
      continue;
    }
    const double factor = units.PlaneAngleFactor();
    if (!(factor > 0)) continue;
    if (isConversion) {
      if (haveConversion && std::fabs(conversion - factor) > 1e-12 * factor) return false;
      conversion = factor;
      haveConversion = true;
    } else if (!haveSi) {
      si = factor;
      haveSi = true;
    }
  }
  if (haveConversion) {
    radPerUnit = conversion;
    return true;
  }
  if (haveSi) {
    radPerUnit = si;
    return true;
  }
  return false;
}

// One import issue: a stable `code` per cause and what it cost (`severity`).
void pmiIssue(PmiImportContext& ctx, const std::string& name, const char* code,
              const char* severity, const std::string& reason) {
  std::string json = "{";
  if (!name.empty()) json += "\"name\":" + jsonString(name) + ",";
  json += "\"reason\":" + jsonString(reason) + ",\"code\":\"" + code + "\",\"severity\":\"" +
          severity + "\"}";
  ctx.issues.push_back(std::move(json));
}

const ShapeMap& topoMap(const Topo& topo, TopAbs_ShapeEnum kind) {
  return kind == TopAbs_FACE ? topo.faces : kind == TopAbs_EDGE ? topo.edges : topo.vertices;
}

const char* kindName(TopAbs_ShapeEnum kind) {
  return kind == TopAbs_FACE ? "face" : kind == TopAbs_EDGE ? "edge" : "vertex";
}

const char* kindWithArticle(TopAbs_ShapeEnum kind) {
  return kind == TopAbs_FACE ? "a face" : kind == TopAbs_EDGE ? "an edge" : "a vertex";
}

// One face/edge/vertex → a target on the returned bodies. Exact match (same TShape and
// location) first; a sub-shape of an instanced part definition matches by TShape, on the first
// instance (`instanced` tells the caller, which reports it).
bool mapPmiSubShape(PmiImportContext& ctx, const TopoDS_Shape& s, std::string& json,
                    bool& instanced) {
  const TopAbs_ShapeEnum kind = s.ShapeType();
  for (size_t b = 0; b < ctx.topo.size(); ++b) {
    const int index = topoMap(*ctx.topo[b], kind).FindIndex(s);
    if (index > 0) {
      json = "{\"body\":" + std::to_string(b) + ",\"kind\":\"" + kindName(kind) +
             "\",\"index\":" + std::to_string(index) + "}";
      return true;
    }
  }
  int foundBody = -1;
  int foundIndex = 0;
  int matches = 0;
  for (size_t b = 0; b < ctx.topo.size(); ++b) {
    const ShapeMap& map = topoMap(*ctx.topo[b], kind);
    for (int i = 1; i <= map.Extent(); ++i) {
      if (map.FindKey(i).TShape() == s.TShape()) {
        if (foundBody < 0) {
          foundBody = static_cast<int>(b);
          foundIndex = i;
        }
        ++matches;
        break;
      }
    }
  }
  if (foundBody < 0) return false;
  instanced = instanced || matches > 1;
  json = "{\"body\":" + std::to_string(foundBody) + ",\"kind\":\"" + kindName(kind) +
         "\",\"index\":" + std::to_string(foundIndex) + "}";
  return true;
}

// Why a sub-shape is not on the returned bodies: geometry the file holds beside the solids
// (supplemental curves and surfaces, which the import does not return), or something else.
void unmappedReason(PmiImportContext& ctx, const TopoDS_Shape& atom, std::string& problem,
                    const char*& code) {
  if (!ctx.docShapesLoaded && !ctx.doc.IsNull()) {
    ctx.docShapes = documentSubShapes(ctx.doc);
    ctx.docShapesLoaded = true;
  }
  if (ctx.docShapes.count(atom.TShape().get()) > 0) {
    problem = std::string("it applies to supplemental geometry (") + kindWithArticle(atom.ShapeType()) +
              " the file places beside the solid, not one of its own), which is not imported";
    code = "supplementalGeometry";
    return;
  }
  problem = std::string(kindWithArticle(atom.ShapeType())) +
            " it applies to is not part of the imported bodies";
  code = "targetNotInBodies";
}

// Faces, edges or vertices → targets. False (with `problem`, `code`) when any cannot be mapped:
// an item on fewer faces than the file says would be a silent guess.
bool mapPmiAtoms(PmiImportContext& ctx, const std::vector<TopoDS_Shape>& atoms,
                 std::vector<std::string>& targets, std::string& problem, const char*& code,
                 bool& instanced) {
  for (const TopoDS_Shape& atom : atoms) {
    std::string json;
    if (!mapPmiSubShape(ctx, atom, json, instanced)) {
      unmappedReason(ctx, atom, problem, code);
      return false;
    }
    if (std::find(targets.begin(), targets.end(), json) == targets.end()) targets.push_back(json);
  }
  if (targets.empty()) {
    problem = "it is attached to no geometry";
    code = "noGeometry";
    return false;
  }
  return true;
}

// The faces, edges and vertices of GD&T shape labels; false when a label is not usable.
bool pmiLabelAtoms(const NCollection_Sequence<TDF_Label>& labels, std::vector<TopoDS_Shape>& atoms,
                   std::string& problem, const char*& code) {
  for (int i = 1; i <= labels.Length(); ++i) {
    const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(labels(i));
    if (shape.IsNull()) {
      problem = "a referenced shape is empty";
      code = "noGeometry";
      return false;
    }
    const TopAbs_ShapeEnum t = shape.ShapeType();
    if (t == TopAbs_SOLID || t == TopAbs_COMPSOLID) {
      problem = "it applies to a whole body, not to faces, edges or vertices";
      code = "wholeBody";
      return false;
    }
    const size_t before = atoms.size();
    stepAtoms(shape, atoms);
    if (atoms.size() == before) {
      problem = "a referenced shape holds no faces or edges";
      code = "noGeometry";
      return false;
    }
  }
  return true;
}

bool mapPmiLabels(PmiImportContext& ctx, const NCollection_Sequence<TDF_Label>& labels,
                  std::vector<std::string>& targets, std::string& problem, const char*& code,
                  bool& instanced) {
  std::vector<TopoDS_Shape> atoms;
  if (!pmiLabelAtoms(labels, atoms, problem, code)) return false;
  return mapPmiAtoms(ctx, atoms, targets, problem, code, instanced);
}

// Points of one edge in its orientation: the ends of a line, else a tangential sampling.
std::vector<gp_Pnt> pmiEdgePoints(const TopoDS_Edge& edge) {
  std::vector<gp_Pnt> pts;
  if (BRep_Tool::Degenerated(edge) || !BRep_Tool::IsGeometric(edge)) return pts;
  const BRepAdaptor_Curve curve(edge);
  if (curve.GetType() == GeomAbs_Line) {
    pts.push_back(curve.Value(curve.FirstParameter()));
    pts.push_back(curve.Value(curve.LastParameter()));
  } else {
    GCPnts_TangentialDeflection sampler(curve, 0.05, 1e-3, 2);
    for (int i = 1; i <= sampler.NbPoints(); ++i) pts.push_back(sampler.Value(i));
  }
  if (edge.Orientation() == TopAbs_REVERSED) std::reverse(pts.begin(), pts.end());
  return pts;
}

// Polylines of a presentation shape: the reader returns each tessellated curve strip as a wire
// of line edges; curve-based (non-tessellated) presentations are sampled.
std::vector<std::vector<gp_Pnt>> pmiPolylines(const TopoDS_Shape& prs) {
  std::vector<std::vector<gp_Pnt>> out;
  std::vector<gp_Pnt> current;
  auto flush = [&]() {
    if (current.size() >= 2) out.push_back(current);
    current.clear();
  };
  auto addEdge = [&](const TopoDS_Edge& edge) {
    const std::vector<gp_Pnt> pts = pmiEdgePoints(edge);
    if (pts.size() < 2) return;
    if (!current.empty() && current.back().Distance(pts.front()) > 1e-7) flush();
    for (const gp_Pnt& p : pts) {
      if (current.empty() || current.back().Distance(p) > 1e-9) current.push_back(p);
    }
  };
  for (TopExp_Explorer w(prs, TopAbs_WIRE); w.More(); w.Next()) {
    for (TopoDS_Iterator it(w.Current()); it.More(); it.Next()) {
      if (it.Value().ShapeType() == TopAbs_EDGE) addEdge(TopoDS::Edge(it.Value()));
    }
    flush();
  }
  for (TopExp_Explorer e(prs, TopAbs_EDGE, TopAbs_WIRE); e.More(); e.Next()) {
    addEdge(TopoDS::Edge(e.Current()));
    flush();
  }
  return out;
}

// Filled areas of a presentation shape (the reader makes each complex_triangulated_surface_set a
// face holding only a triangulation): three points per triangle, wound as the face is oriented.
// `untriangulated` counts faces without a triangulation (nothing to show).
std::vector<gp_Pnt> pmiTriangles(const TopoDS_Shape& prs, int& untriangulated) {
  std::vector<gp_Pnt> out;
  untriangulated = 0;
  for (TopExp_Explorer f(prs, TopAbs_FACE); f.More(); f.Next()) {
    const TopoDS_Face face = TopoDS::Face(f.Current());
    TopLoc_Location loc;
    const occ::handle<Poly_Triangulation> mesh = BRep_Tool::Triangulation(face, loc);
    if (mesh.IsNull() || mesh->NbTriangles() == 0) {
      ++untriangulated;
      continue;
    }
    const gp_Trsf trsf = loc.Transformation();
    const bool reversed = face.Orientation() == TopAbs_REVERSED;
    for (int t = 1; t <= mesh->NbTriangles(); ++t) {
      int n1 = 0;
      int n2 = 0;
      int n3 = 0;
      mesh->Triangle(t).Get(n1, n2, n3);
      if (reversed) std::swap(n2, n3);
      for (int n : {n1, n2, n3}) out.push_back(mesh->Node(n).Transformed(trsf));
    }
  }
  return out;
}

std::string pmiPlaneJson(const gp_Ax2& plane) {
  return "{\"origin\":" + jsonPoint(plane.Location()) +
         ",\"x\":" + jsonVec3(plane.XDirection().XYZ()) +
         ",\"normal\":" + jsonVec3(plane.Direction().XYZ()) + "}";
}

// `,"presentation":{…}` for an object's presentation, or empty. Reports what it drops.
template <typename Object>
std::string pmiPresentationMember(PmiImportContext& ctx, const occ::handle<Object>& object,
                                  const std::string& name, bool& hasDrawing) {
  hasDrawing = false;
  const TopoDS_Shape prs = object->GetPresentation();
  if (prs.IsNull()) return std::string();
  const std::vector<std::vector<gp_Pnt>> lines = pmiPolylines(prs);
  int untriangulated = 0;
  const std::vector<gp_Pnt> triangles = pmiTriangles(prs, untriangulated);
  if (untriangulated > 0) {
    pmiIssue(ctx, name, "filledPresentation", kCosmetic,
             std::to_string(untriangulated) +
                 " filled presentation area(s) hold no triangles and are not shown");
  }
  if (lines.empty() && triangles.empty()) return std::string();
  gp_Ax2 plane;
  if (object->HasPlane()) {
    plane = object->GetPlane();
  } else {
    plane = gp_Ax2(object->GetPointTextAttach(), gp::DZ(), gp::DX());
    pmiIssue(ctx, name, "presentationNoPlane", kCosmetic,
             "the presentation has no annotation plane; it is placed on the XY plane");
  }
  std::string json = ",\"presentation\":{\"plane\":" + pmiPlaneJson(plane) + ",\"polylines\":[";
  for (size_t i = 0; i < lines.size(); ++i) {
    if (i > 0) json.push_back(',');
    json.push_back('[');
    for (size_t j = 0; j < lines[i].size(); ++j) {
      if (j > 0) json.push_back(',');
      json += jsonPoint(lines[i][j]);
    }
    json.push_back(']');
  }
  json += "]";
  if (!triangles.empty()) {
    json += ",\"triangles\":[";
    for (size_t i = 0; i < triangles.size(); ++i) {
      if (i > 0) json.push_back(',');
      json += jsonPoint(triangles[i]);
    }
    json += "]";
  }
  json += "}";
  hasDrawing = true;
  return json;
}

std::string pmiTargetsJson(const std::vector<std::string>& targets) {
  std::string json = "[";
  for (size_t i = 0; i < targets.size(); ++i) {
    if (i > 0) json.push_back(',');
    json += targets[i];
  }
  return json + "]";
}

// The label's name when it is a user-facing one (OCCT names unnamed GD&T "DGT:…").
std::string pmiLabelName(const TDF_Label& label) {
  const std::string name = labelName(label);
  if (name.rfind("DGT:", 0) == 0) return std::string();
  return name;
}

// What a file calls an item: its presentation name (Wren writes the annotation id there), else a
// user-facing label name.
template <typename Object>
std::string pmiItemName(const occ::handle<Object>& object, const std::string& fallback) {
  const std::string prs = hasciiText(object->GetPresentationName());
  return prs.empty() ? fallback : prs;
}

std::string nameMember(const std::string& name) {
  return name.empty() ? std::string() : ",\"name\":" + jsonString(name);
}

const char* pmiDimensionTypeName(XCAFDimTolObjects_DimensionType t) {
  switch (t) {
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance:
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromCenterToOuter:
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromCenterToInner:
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromOuterToCenter:
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromOuterToOuter:
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromOuterToInner:
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromInnerToCenter:
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromInnerToOuter:
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromInnerToInner:
    case XCAFDimTolObjects_DimensionType_Location_Oriented:
      return "linearDistance";
    case XCAFDimTolObjects_DimensionType_Location_Angular:
    case XCAFDimTolObjects_DimensionType_Size_Angular:
      return "angular";
    case XCAFDimTolObjects_DimensionType_Size_Diameter:
    case XCAFDimTolObjects_DimensionType_Size_SphericalDiameter:
      return "linearDiameter";
    case XCAFDimTolObjects_DimensionType_Size_Radius:
    case XCAFDimTolObjects_DimensionType_Size_SphericalRadius:
      return "linearRadius";
    case XCAFDimTolObjects_DimensionType_Size_Thickness:
      return "size";
    case XCAFDimTolObjects_DimensionType_Size_CurveLength:
      return "curveLength";
    default:
      return "other";
  }
}

// A STEP dimension name ('linear distance', 'diameter', …) as a contracts type.
std::string stepDimensionTypeName(const std::string& stepName) {
  TCollection_AsciiString n(stepName.c_str());
  n.LowerCase();
  const std::string s = n.ToCString();
  if (s.rfind("linear distance", 0) == 0) return "linearDistance";
  if (s == "diameter" || s == "spherical diameter") return "linearDiameter";
  if (s == "radius" || s == "spherical radius") return "linearRadius";
  if (s == "thickness") return "size";
  if (s == "curve length") return "curveLength";
  if (s == "angle") return "angular";
  return "other";
}

void importPmiPresentationOnly(PmiImportContext& ctx,
                               const occ::handle<XCAFDimTolObjects_DimensionObject>& object,
                               const std::string& name) {
  bool hasDrawing = false;
  const std::string prs = pmiPresentationMember(ctx, object, name, hasDrawing);
  if (!hasDrawing) {
    pmiIssue(ctx, name, "presentationEmpty", kLost,
             "a presentation-only annotation has nothing to show");
    return;
  }
  ctx.items.push_back("{\"kind\":\"presentationOnly\"" + nameMember(name) + prs + "}");
}

// TShapes of the faces, edges and vertices of GD&T shape labels (to match STEP entities).
std::set<const TopoDS_TShape*> labelTShapes(const NCollection_Sequence<TDF_Label>& labels) {
  std::vector<TopoDS_Shape> atoms;
  for (int i = 1; i <= labels.Length(); ++i) stepAtoms(XCAFDoc_ShapeTool::GetShape(labels(i)), atoms);
  return tshapeSet(atoms);
}

// The STEP entity behind an XCAF dimension: OCCT creates the labels in entity order, so the first
// unmatched entity of the same kind and type on the same faces is it.
StepDimensionInfo* linkStepDimension(PmiImportContext& ctx, const NCollection_Sequence<TDF_Label>& first,
                                     const NCollection_Sequence<TDF_Label>& second,
                                     const std::string& typeName) {
  if (ctx.stepDims.empty()) return nullptr;
  const std::set<const TopoDS_TShape*> a = labelTShapes(first);
  const std::set<const TopoDS_TShape*> b = labelTShapes(second);
  const bool location = second.Length() > 0;
  for (StepDimensionInfo& d : ctx.stepDims) {
    if (d.used || d.location != location || !d.hasValue) continue;
    // An unnamed location is OCCT's oriented form of a linear distance; "other" is anything.
    const std::string stepType = d.type.empty() ? std::string("linearDistance") : stepDimensionTypeName(d.type);
    if (typeName != "other" && stepType != typeName) continue;
    if (d.first == a && d.second == b) {
      d.used = true;
      return &d;
    }
  }
  return nullptr;
}

// A cylindrical or conical face measures from its axis; anything else from its centre.
std::string centreQualifier(const TopoDS_Shape& atom) {
  if (atom.ShapeType() == TopAbs_FACE) {
    const BRepAdaptor_Surface surface(TopoDS::Face(atom), false);
    if (surface.GetType() == GeomAbs_Cylinder || surface.GetType() == GeomAbs_Cone) return "axis";
  }
  return "center";
}

void importPmiDimension(PmiImportContext& ctx, const TDF_Label& label) {
  occ::handle<XCAFDoc_Dimension> attr;
  if (!label.FindAttribute(XCAFDoc_Dimension::GetID(), attr)) return;
  const occ::handle<XCAFDimTolObjects_DimensionObject> object = attr->GetObject();
  if (object.IsNull()) {
    pmiIssue(ctx, pmiLabelName(label), "noData", kLost, "a dimension without data");
    return;
  }
  const XCAFDimTolObjects_DimensionType type = object->GetType();
  const std::string name = pmiItemName(object, std::string());
  if (type == XCAFDimTolObjects_DimensionType_DimensionPresentation ||
      type == XCAFDimTolObjects_DimensionType_CommonLabel) {
    importPmiPresentationOnly(ctx, object, name);
    return;
  }
  const occ::handle<NCollection_HArray1<double>> values = object->GetValues();
  if (values.IsNull() || values->Length() == 0) {
    // OCCT 8.0.1 sets nothing on a dimension without a dimensional_characteristic_representation
    // (no value, type, name or presentation): reported from the STEP model, which has them.
    ++ctx.noValueLabels;
    return;
  }
  std::string typeName = pmiDimensionTypeName(type);
  NCollection_Sequence<TDF_Label> first;
  NCollection_Sequence<TDF_Label> second;
  XCAFDoc_DimTolTool::GetRefShapeLabel(label, first, second);
  // Copies: NCollection_Sequence::Append(sequence) splices, which would empty `second`.
  NCollection_Sequence<TDF_Label> all = first;
  for (int i = 1; i <= second.Length(); ++i) all.Append(second(i));
  std::vector<std::string> targets;
  std::string problem;
  const char* code = "noGeometry";
  bool instanced = false;
  if (!mapPmiLabels(ctx, all, targets, problem, code, instanced)) {
    pmiIssue(ctx, name, code, kLost, typeName + " dimension not imported: " + problem);
    return;
  }
  if (instanced) {
    pmiIssue(ctx, name, "instanced", kApproximated,
             "the part is instanced several times; the dimension is on the first");
  }
  // Measuring direction: the 'orientation' placement of the STEP entity (CAx-IF), for a linear
  // distance (which OCCT's reader ignores) and for OCCT's own unnamed oriented form alike.
  // XCAFDimTolObjects_DimensionObject::GetDirection cannot tell: it always returns true, with
  // (1, 0, 0) when nothing was set.
  bool hasDirection = false;
  gp_Dir direction;
  StepDimensionInfo* step = linkStepDimension(ctx, first, second, typeName);
  if (typeName == "linearDistance" || type == XCAFDimTolObjects_DimensionType_Location_None) {
    if (step != nullptr && step->hasOrientation) {
      direction = step->orientation;
      hasDirection = true;
    }
  }
  if (type == XCAFDimTolObjects_DimensionType_Location_None && hasDirection && second.Length() > 0) {
    typeName = "linearDistance";  // OCCT's reading of an oriented dimensional location
  }
  const bool angular = typeName == "angular";
  // OCCT's reader gives angles in degrees; the contracts use radians.
  const double scale = angular ? kPi / 180.0 : 1.0;
  double value = object->GetValue() * scale;
  std::string tolerance;
  if (object->IsDimWithRange()) {
    const double lo = object->GetLowerBound() * scale;
    const double hi = object->GetUpperBound() * scale;
    value = 0.5 * (lo + hi);
    tolerance = ",\"tolerance\":{\"kind\":\"deviation\",\"upper\":" + jsonNumber(hi - value) +
                ",\"lower\":" + jsonNumber(lo - value) + "}";
  } else if (object->IsDimWithPlusMinusTolerance()) {
    // Deviations stay in the file's unit for angles (see PmiImportContext::angleUnitRad).
    double deviationScale = 1.0;
    if (angular) {
      if (ctx.angleUnitKnown) {
        deviationScale = ctx.angleUnitRad;
      } else {
        pmiIssue(ctx, name, "angleUnit", kApproximated,
                 "the file's angle unit is unclear; angular deviations read as radians");
      }
    }
    tolerance = ",\"tolerance\":{\"kind\":\"deviation\",\"upper\":" +
                jsonNumber(object->GetUpperTolValue() * deviationScale) +
                ",\"lower\":" + jsonNumber(-object->GetLowerTolValue() * deviationScale) + "}";
  }
  bool hole = false;
  XCAFDimTolObjects_DimensionFormVariance variance = XCAFDimTolObjects_DimensionFormVariance_None;
  XCAFDimTolObjects_DimensionGrade grade = XCAFDimTolObjects_DimensionGrade_IT01;
  if (object->GetClassOfTolerance(hole, variance, grade)) {
    const std::string cls = fitClassText(hole, variance, grade);
    if (cls.empty()) {
      pmiIssue(ctx, name, "fitClass", kApproximated,
               "the dimension's class of tolerance is not an ISO 286 class");
    } else if (!tolerance.empty()) {
      pmiIssue(ctx, name, "fitAndDeviation", kApproximated,
               "the dimension has deviations and a class " + cls + "; the class is dropped");
    } else {
      tolerance = std::string(",\"tolerance\":{\"kind\":\"fit\",\"") + (hole ? "hole" : "shaft") +
                  "\":" + jsonString(cls) + "}";
    }
  }
  // Descriptions: basic/reference (CAx-IF dimensional note), Wren's measured points and form.
  std::string qualifier;
  std::vector<std::string> at;
  bool ordinate = false;
  for (int i = 0; i < object->NbDescriptions(); ++i) {
    TCollection_AsciiString key(hasciiText(object->GetDescriptionName(i)).c_str());
    key.LowerCase();
    const std::string text = hasciiText(object->GetDescription(i));
    if (key.IsEqual(kDimensionalNote)) {
      if (text == "theoretical") {
        qualifier = "basic";
      } else if (text == "auxiliary") {
        qualifier = "reference";
      } else {
        pmiIssue(ctx, name, "dimensionNote", kApproximated,
                 "the dimensional note '" + text + "' is not imported");
      }
    } else if (key.IsEqual(kWrenPointsDescription)) {
      std::vector<std::string> parsed;
      std::string token;
      bool valid = true;
      for (size_t c = 0; c <= text.size(); ++c) {
        if (c == text.size() || text[c] == ',') {
          valid = valid && isRefPoint(token);
          parsed.push_back(token);
          token.clear();
        } else {
          token.push_back(text[c]);
        }
      }
      if (valid && parsed.size() <= targets.size()) {
        at = parsed;
      } else {
        pmiIssue(ctx, name, "pointQualifier", kApproximated,
                 "the measured points '" + text + "' do not match the dimension's targets");
      }
    } else if (key.IsEqual(kWrenFormDescription)) {
      if (text == "ordinate" && typeName == "linearDistance" && hasDirection) {
        ordinate = true;
      } else {
        pmiIssue(ctx, name, "dimensionForm", kApproximated,
                 "the dimension form '" + text + "' is not imported");
      }
    }
  }
  if (!qualifier.empty() && !tolerance.empty()) {
    pmiIssue(ctx, name, "qualifierWithTolerance", kApproximated,
             "a " + qualifier + " dimension carries a tolerance; the tolerance is dropped");
    tolerance.clear();
  }
  // Centre / outer / inner forms of a linear distance between one face, edge or vertex each.
  int fromKind = 0;  // 0 none, else 1 centre, 2 outer, 3 inner, per side
  int toKind = 0;
  switch (type) {
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromCenterToOuter: fromKind = 1; toKind = 2; break;
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromCenterToInner: fromKind = 1; toKind = 3; break;
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromOuterToCenter: fromKind = 2; toKind = 1; break;
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromOuterToOuter: fromKind = 2; toKind = 2; break;
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromOuterToInner: fromKind = 2; toKind = 3; break;
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromInnerToCenter: fromKind = 3; toKind = 1; break;
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromInnerToOuter: fromKind = 3; toKind = 2; break;
    case XCAFDimTolObjects_DimensionType_Location_LinearDistance_FromInnerToInner: fromKind = 3; toKind = 3; break;
    default: break;
  }
  if (fromKind != 0 && at.empty()) {
    std::vector<TopoDS_Shape> a;
    std::vector<TopoDS_Shape> b;
    for (int i = 1; i <= first.Length(); ++i) stepAtoms(XCAFDoc_ShapeTool::GetShape(first(i)), a);
    for (int i = 1; i <= second.Length(); ++i) stepAtoms(XCAFDoc_ShapeTool::GetShape(second(i)), b);
    if (a.size() == 1 && b.size() == 1 && targets.size() == 2) {
      at = {fromKind == 1 ? centreQualifier(a[0]) : "self", toKind == 1 ? centreQualifier(b[0]) : "self"};
    }
    if (fromKind != 1 || toKind != 1 || at.empty()) {
      pmiIssue(ctx, name, "pointQualifier", kApproximated,
               "the outer or inner points of the linear distance are not imported; it measures "
               "from the faces");
    }
    bool allSelf = true;
    for (const std::string& q : at) allSelf = allSelf && q == "self";
    if (allSelf) at.clear();
  }
  if (object->GetModifiers().Length() > 0 || object->HasQualifier()) {
    pmiIssue(ctx, name, "dimensionModifier", kApproximated,
             "dimension modifiers and qualifiers (min, max, controlled radius, …) are not imported");
  } else if (step != nullptr && !step->unparsedModifiers.empty()) {
    std::string list;
    for (const std::string& m : step->unparsedModifiers) list += (list.empty() ? "" : ", ") + m;
    pmiIssue(ctx, name, "dimensionModifier", kApproximated, "dimension modifiers not imported: " + list);
  }
  if (object->HasPoint() || object->HasPoint2()) {
    pmiIssue(ctx, name, "connectionPoints", kApproximated,
             "the dimension's connection points are not imported; it measures between its targets");
  }
  const bool spherical = type == XCAFDimTolObjects_DimensionType_Size_SphericalDiameter ||
                         type == XCAFDimTolObjects_DimensionType_Size_SphericalRadius;
  std::string v2;
  if (hasDirection && typeName == "linearDistance") v2 += ",\"direction\":" + jsonVec3(direction.XYZ());
  if (!at.empty()) v2 += ",\"at\":" + jsonStringArray(at);
  if (!qualifier.empty()) v2 += ",\"qualifier\":\"" + qualifier + "\"";
  if (ordinate) v2 += ",\"ordinate\":true";
  if (spherical) v2 += ",\"spherical\":true";
  bool hasDrawing = false;
  const std::string prs = pmiPresentationMember(ctx, object, name, hasDrawing);
  ctx.items.push_back("{\"kind\":\"dimension\",\"type\":\"" + typeName + "\",\"targets\":" +
                      pmiTargetsJson(targets) + ",\"value\":" + jsonNumber(value) + tolerance + v2 +
                      nameMember(name) + prs + "}");
}

const char* pmiToleranceTypeName(XCAFDimTolObjects_GeomToleranceType t) {
  for (const ToleranceTypeName& n : kToleranceTypes) {
    if (n.type == t) return n.name;
  }
  return nullptr;
}

// Material modifier ("M" / "L") among datum reference modifiers, or empty; `other` is set when
// other modifiers are present.
std::string datumMaterial(const occ::handle<XCAFDimTolObjects_DatumObject>& datum, bool& other) {
  std::string material;
  const NCollection_Sequence<XCAFDimTolObjects_DatumSingleModif> modifiers = datum->GetModifiers();
  for (int i = 1; i <= modifiers.Length(); ++i) {
    if (modifiers(i) == XCAFDimTolObjects_DatumSingleModif_MaximumMaterialRequirement) {
      material = "M";
    } else if (modifiers(i) == XCAFDimTolObjects_DatumSingleModif_LeastMaterialRequirement) {
      material = "L";
    } else {
      other = true;
    }
  }
  XCAFDimTolObjects_DatumModifWithValue withValue = XCAFDimTolObjects_DatumModifWithValue_None;
  double modifierValue = 0.0;
  datum->GetModifierWithValue(withValue, modifierValue);
  if (withValue != XCAFDimTolObjects_DatumModifWithValue_None) other = true;
  return material;
}

void importPmiTolerance(PmiImportContext& ctx, const TDF_Label& label) {
  occ::handle<XCAFDoc_GeomTolerance> attr;
  if (!label.FindAttribute(XCAFDoc_GeomTolerance::GetID(), attr)) {
    pmiIssue(ctx, pmiLabelName(label), "noData", kLost, "a geometric tolerance without data");
    return;
  }
  const occ::handle<XCAFDimTolObjects_GeomToleranceObject> object = attr->GetObject();
  if (object.IsNull()) {
    pmiIssue(ctx, pmiLabelName(label), "noData", kLost, "a geometric tolerance without data");
    return;
  }
  const std::string name = pmiItemName(object, pmiLabelName(label));
  const char* type = pmiToleranceTypeName(object->GetType());
  if (type == nullptr) {
    pmiIssue(ctx, name, "unknownType", kLost, "a geometric tolerance of unknown type");
    return;
  }
  NCollection_Sequence<TDF_Label> first;
  NCollection_Sequence<TDF_Label> second;
  XCAFDoc_DimTolTool::GetRefShapeLabel(label, first, second);
  first.Append(second);
  // The STEP entity: OCCT creates tolerance labels in entity order, so the first unmatched
  // tolerance on the same faces is it.
  StepToleranceInfo* step = nullptr;
  {
    const std::set<const TopoDS_TShape*> shapes = labelTShapes(first);
    for (StepToleranceInfo& t : ctx.stepTols) {
      if (!t.used && t.shapes == shapes) {
        t.used = true;
        step = &t;
        break;
      }
    }
  }
  std::vector<std::string> targets;
  std::string problem;
  const char* code = "noGeometry";
  bool instanced = false;
  if (!mapPmiLabels(ctx, first, targets, problem, code, instanced)) {
    pmiIssue(ctx, name, code, kLost, std::string(type) + " tolerance not imported: " + problem);
    return;
  }
  if (instanced) {
    pmiIssue(ctx, name, "instanced", kApproximated,
             "the part is instanced several times; the tolerance is on the first");
  }
  std::string json = std::string("{\"kind\":\"tolerance\",\"type\":\"") + type +
                     "\",\"targets\":" + pmiTargetsJson(targets) +
                     ",\"value\":" + jsonNumber(object->GetValue());
  const XCAFDimTolObjects_GeomToleranceTypeValue zone = object->GetTypeOfValue();
  if (zone == XCAFDimTolObjects_GeomToleranceTypeValue_Diameter ||
      zone == XCAFDimTolObjects_GeomToleranceTypeValue_SphericalDiameter) {
    json += ",\"diameter\":true";
    if (zone == XCAFDimTolObjects_GeomToleranceTypeValue_SphericalDiameter) {
      json += ",\"spherical\":true";
    }
  }
  const XCAFDimTolObjects_GeomToleranceMatReqModif mat = object->GetMaterialRequirementModifier();
  if (mat == XCAFDimTolObjects_GeomToleranceMatReqModif_M) json += ",\"material\":\"M\"";
  if (mat == XCAFDimTolObjects_GeomToleranceMatReqModif_L) json += ",\"material\":\"L\"";
  // Zone modifiers, all around / all over, projected zones.
  std::vector<std::string> modifiers;
  bool allAround = false;
  std::vector<std::string> unread;
  bool separate = false;
  const NCollection_Sequence<XCAFDimTolObjects_GeomToleranceModif> mods = object->GetModifiers();
  for (int i = 1; i <= mods.Length(); ++i) {
    const char* m = nullptr;
    switch (mods(i)) {
      case XCAFDimTolObjects_GeomToleranceModif_Free_State: m = "freeState"; break;
      case XCAFDimTolObjects_GeomToleranceModif_Tangent_Plane: m = "tangentPlane"; break;
      case XCAFDimTolObjects_GeomToleranceModif_Statistical_Tolerance: m = "statistical"; break;
      case XCAFDimTolObjects_GeomToleranceModif_Common_Zone: m = "combinedZone"; break;
      case XCAFDimTolObjects_GeomToleranceModif_Separate_Requirement:
        m = "separateZones";
        separate = true;
        break;
      case XCAFDimTolObjects_GeomToleranceModif_All_Around:
      case XCAFDimTolObjects_GeomToleranceModif_All_Over:
        allAround = true;
        break;
      case XCAFDimTolObjects_GeomToleranceModif_Any_Cross_Section: unread.push_back("any cross section"); break;
      case XCAFDimTolObjects_GeomToleranceModif_Each_Radial_Element: unread.push_back("each radial element"); break;
      case XCAFDimTolObjects_GeomToleranceModif_Line_Element: unread.push_back("line element"); break;
      case XCAFDimTolObjects_GeomToleranceModif_Major_Diameter: unread.push_back("major diameter"); break;
      case XCAFDimTolObjects_GeomToleranceModif_Minor_Diameter: unread.push_back("minor diameter"); break;
      case XCAFDimTolObjects_GeomToleranceModif_Pitch_Diameter: unread.push_back("pitch diameter"); break;
      case XCAFDimTolObjects_GeomToleranceModif_Not_Convex: unread.push_back("not convex"); break;
      case XCAFDimTolObjects_GeomToleranceModif_Reciprocity_Requirement: unread.push_back("reciprocity"); break;
      default: unread.push_back("another modifier"); break;
    }
    if (m != nullptr && std::find(modifiers.begin(), modifiers.end(), m) == modifiers.end()) {
      modifiers.push_back(m);
    }
  }
  if (!modifiers.empty()) json += ",\"modifiers\":" + jsonStringArray(modifiers);
  if (step != nullptr && step->hasProjected) {
    // From the STEP entity, in mm: OCCT 8.0.1's value is scaled by its cascade unit.
    json += ",\"projected\":" + jsonNumber(step->projected);
  } else if (object->GetZoneModifier() == XCAFDimTolObjects_GeomToleranceZoneModif_Projected) {
    unread.push_back("projected zone (its height could not be read)");
  } else if (object->GetZoneModifier() == XCAFDimTolObjects_GeomToleranceZoneModif_Runout) {
    unread.push_back("runout zone angle");
  } else if (object->GetZoneModifier() == XCAFDimTolObjects_GeomToleranceZoneModif_NonUniform) {
    unread.push_back("non-uniform zone");
  }
  if (allAround) json += ",\"allAround\":true";
  if (object->GetMaxValueModifier() != 0.0) unread.push_back("maximum value");
  if (separate) {
    pmiIssue(ctx, name, "separateRequirement", kApproximated,
             "the separate requirement (SEP REQT) is read as separate zones (SZ)");
  }
  if (!unread.empty()) {
    std::string list;
    for (const std::string& u : unread) list += (list.empty() ? "" : ", ") + u;
    pmiIssue(ctx, name, "toleranceModifier", kApproximated,
             "tolerance modifiers not imported: " + list);
  }
  // Datum reference frame, by precedence.
  NCollection_Sequence<TDF_Label> datumLabels;
  XCAFDoc_DimTolTool::GetDatumWithObjectOfTolerLabels(label, datumLabels);
  std::vector<std::pair<int, std::string>> refs;  // position, JSON
  bool otherModifiers = false;
  for (int i = 1; i <= datumLabels.Length(); ++i) {
    occ::handle<XCAFDoc_Datum> datumAttr;
    if (!datumLabels(i).FindAttribute(XCAFDoc_Datum::GetID(), datumAttr)) continue;
    const occ::handle<XCAFDimTolObjects_DatumObject> datum = datumAttr->GetObject();
    if (datum.IsNull()) continue;
    const std::string datumLabel = hasciiText(datum->GetName());
    if (datumLabel.empty()) {
      pmiIssue(ctx, name, "datumReferenceUnlabelled", kApproximated,
               "a datum reference without a label is not imported");
      continue;
    }
    const std::string material = datumMaterial(datum, otherModifiers);
    std::string ref = "{\"label\":" + jsonString(datumLabel);
    if (!material.empty()) ref += ",\"material\":\"" + material + "\"";
    ref += "}";
    refs.emplace_back(datum->GetPosition(), ref);
  }
  std::stable_sort(refs.begin(), refs.end(),
                   [](const std::pair<int, std::string>& a, const std::pair<int, std::string>& b) {
                     return a.first < b.first;
                   });
  // One reference per position: a datum target and its datum share a compartment.
  std::vector<std::pair<int, std::string>> unique;
  for (const auto& r : refs) {
    if (unique.empty() || unique.back().first != r.first || unique.back().second != r.second) {
      unique.push_back(r);
    }
  }
  refs = unique;
  if (otherModifiers) {
    pmiIssue(ctx, name, "datumModifier", kApproximated,
             "datum reference modifiers other than M and L are not imported");
  }
  if (refs.size() > 3) {
    pmiIssue(ctx, name, "datumFrameLength", kApproximated,
             "a datum reference frame of more than three datums; the first three are kept");
    refs.resize(3);
  }
  if (!refs.empty()) {
    json += ",\"datums\":[";
    for (size_t i = 0; i < refs.size(); ++i) {
      if (i > 0) json.push_back(',');
      json += refs[i].second;
    }
    json += "]";
  }
  bool hasDrawing = false;
  json += nameMember(name) + pmiPresentationMember(ctx, object, name, hasDrawing) + "}";
  ctx.items.push_back(std::move(json));
}

// Datums. OCCT creates one datum label per tolerance reference and attaches faces only through a
// geometric_item_specific_usage of the datum feature; the STEP model (stepDatums) supplies the
// faces the file gives otherwise, and the datums no tolerance references. A datum item is the
// label (by name) with geometry, plus the first presentation found among its labels.
void importPmiDatums(PmiImportContext& ctx, const occ::handle<XCAFDoc_DimTolTool>& dimTol) {
  NCollection_Sequence<TDF_Label> labels;
  dimTol->GetDatumLabels(labels);
  std::vector<std::string> order;
  std::map<std::string, std::vector<TDF_Label>> byName;
  const bool step = ctx.step != nullptr && ctx.step->valid();
  for (int i = 1; i <= labels.Length(); ++i) {
    occ::handle<XCAFDoc_Datum> attr;
    if (!labels(i).FindAttribute(XCAFDoc_Datum::GetID(), attr)) continue;
    const occ::handle<XCAFDimTolObjects_DatumObject> datum = attr->GetObject();
    if (datum.IsNull()) continue;
    const std::string label = hasciiText(datum->GetName());
    if (datum->IsDatumTarget()) {
      // Reported per datum from the STEP model when it is available.
      if (!step) {
        pmiIssue(ctx, label + std::to_string(datum->GetDatumTargetNumber()), "datumTarget", kLost,
                 "datum target " + label + std::to_string(datum->GetDatumTargetNumber()) +
                     " not imported: datum targets need their own annotation kind");
      }
      continue;
    }
    if (label.empty()) {
      pmiIssue(ctx, std::string(), "datumUnlabelled", kLost, "a datum without a label is not imported");
      continue;
    }
    if (byName.find(label) == byName.end()) order.push_back(label);
    byName[label].push_back(labels(i));
  }
  std::vector<StepDatumInfo> fileDatums;
  if (step) fileDatums = stepDatums(*ctx.step);
  auto fileDatum = [&](const std::string& label) -> const StepDatumInfo* {
    for (const StepDatumInfo& d : fileDatums) {
      if (d.label == label) return &d;
    }
    return nullptr;
  };
  // Datums the file defines only through datum targets, or that no tolerance references.
  for (const StepDatumInfo& d : fileDatums) {
    if (!d.hasFeature && !d.targets.empty()) {
      std::string list;
      for (const std::string& t : d.targets) list += (list.empty() ? "" : ", ") + t;
      pmiIssue(ctx, d.label, "datumTarget", kLost,
               "datum " + d.label + " not imported: it is defined by datum targets (" + list +
                   "), which need their own annotation kind");
      continue;
    }
    for (const std::string& t : d.targets) {
      pmiIssue(ctx, t, "datumTarget", kLost,
               "datum target " + t + " not imported: datum targets need their own annotation kind");
    }
    if (byName.find(d.label) == byName.end() && d.hasFeature && !d.label.empty()) {
      order.push_back(d.label);
      byName[d.label];  // no XCAF label: the STEP model is the only source
    }
  }
  for (const std::string& label : order) {
    std::vector<std::string> targets;
    std::string problem = "the file attaches its datum feature to no faces";
    const char* code = "datumNoGeometry";
    bool instanced = false;
    bool mapped = false;
    std::string name;
    std::string prs;
    for (const TDF_Label& l : byName[label]) {
      occ::handle<XCAFDoc_Datum> attr;
      l.FindAttribute(XCAFDoc_Datum::GetID(), attr);
      const occ::handle<XCAFDimTolObjects_DatumObject> datum = attr->GetObject();
      if (!mapped) {
        NCollection_Sequence<TDF_Label> first;
        NCollection_Sequence<TDF_Label> second;
        XCAFDoc_DimTolTool::GetRefShapeLabel(l, first, second);
        first.Append(second);
        if (first.Length() > 0) {
          targets.clear();
          mapped = mapPmiLabels(ctx, first, targets, problem, code, instanced);
        }
      }
      if (prs.empty()) {
        const std::string n = pmiItemName(datum, std::string());
        bool hasDrawing = false;
        prs = pmiPresentationMember(ctx, datum, n.empty() ? label : n, hasDrawing);
        if (hasDrawing || name.empty()) name = n;
      }
    }
    const StepDatumInfo* file = fileDatum(label);
    if (!mapped && file != nullptr && std::strcmp(code, "datumNoGeometry") == 0) {
      if (file->ambiguous) {
        problem = "the file links its symbol to different faces (a tolerance and a shape aspect "
                  "disagree)";
        code = "datumAmbiguous";
      } else if (!file->shapes.empty()) {
        targets.clear();
        mapped = mapPmiAtoms(ctx, file->shapes, targets, problem, code, instanced);
      }
    }
    if (name.empty() && file != nullptr) name = file->name;
    bool presentationRead = false;
#ifdef WHITTLE_OCCT_READ_ANNOTATION
    if (mapped && byName[label].empty() && file != nullptr && !file->presentedFeature.IsNull() &&
        !ctx.step->tr.IsNull()) {
      // The reader's own presentation code, on the datum feature (default factors: the cascade
      // unit is the millimetre; it takes the file's units from the draughting model).
      occ::handle<XCAFDimTolObjects_DatumObject> datum = new XCAFDimTolObjects_DatumObject();
      readAnnotation(ctx.step->tr, file->presentedFeature, datum, StepData_Factors());
      bool hasDrawing = false;
      prs = pmiPresentationMember(ctx, datum, name.empty() ? label : name, hasDrawing);
      presentationRead = hasDrawing;
    }
#endif
    if (!mapped) {
      pmiIssue(ctx, name.empty() ? label : name, code, kLost, "datum " + label + " not imported: " + problem);
      continue;
    }
    if (instanced) {
      pmiIssue(ctx, name.empty() ? label : name, "instanced", kApproximated,
               "the part is instanced several times; the datum is on the first");
    }
    if (byName[label].empty() && file != nullptr && file->presented && !presentationRead) {
      pmiIssue(ctx, name.empty() ? label : name, "presentationNotRead", kCosmetic,
               "datum " + label + " is shown without its presentation (OCCT reads a datum's "
                                  "presentation only through a tolerance that references it)");
    }
    ctx.items.push_back("{\"kind\":\"datum\",\"label\":" + jsonString(label) + ",\"targets\":" +
                        pmiTargetsJson(targets) + nameMember(name) + prs + "}");
  }
}

// STEP entity names of the contract tolerance types.
const std::pair<const char*, const char*> kStepToleranceTypes[] = {
    {"STRAIGHTNESS_TOLERANCE", "straightness"},   {"FLATNESS_TOLERANCE", "flatness"},
    {"ROUNDNESS_TOLERANCE", "circularity"},       {"CYLINDRICITY_TOLERANCE", "cylindricity"},
    {"LINE_PROFILE_TOLERANCE", "profileOfLine"},  {"SURFACE_PROFILE_TOLERANCE", "profileOfSurface"},
    {"PARALLELISM_TOLERANCE", "parallelism"},     {"PERPENDICULARITY_TOLERANCE", "perpendicularity"},
    {"ANGULARITY_TOLERANCE", "angularity"},       {"POSITION_TOLERANCE", "position"},
    {"CONCENTRICITY_TOLERANCE", "concentricity"}, {"COAXIALITY_TOLERANCE", "coaxiality"},
    {"SYMMETRY_TOLERANCE", "symmetry"},           {"CIRCULAR_RUNOUT_TOLERANCE", "circularRunout"},
    {"TOTAL_RUNOUT_TOLERANCE", "totalRunout"},
};

// A tolerance OCCT 8.0.1 has no class for (a complex entity with a part it does not know, such as
// a per-unit-area zone): its type, value and faces are read from the entity itself. Only without
// a datum reference frame (its datum system is not read this way). What the contract cannot hold
// is reported as approximated. False when it cannot be read this way.
bool importUnreadTolerance(PmiImportContext& ctx, const StepUnreadEntity& u) {
  if (u.kind != "tolerance" || u.datumReference || u.magnitude.IsNull() || u.aspect.IsNull() ||
      ctx.step == nullptr) {
    return false;
  }
  const char* type = nullptr;
  for (const auto& t : kStepToleranceTypes) {
    if (u.stepType == t.first) type = t.second;
  }
  occ::handle<StepBasic_MeasureWithUnit> magnitude =
      occ::down_cast<StepBasic_MeasureWithUnit>(u.magnitude);
  if (magnitude.IsNull()) {
    const occ::handle<StepRepr_ReprItemAndMeasureWithUnit> ri =
        occ::down_cast<StepRepr_ReprItemAndMeasureWithUnit>(u.magnitude);
    if (!ri.IsNull()) magnitude = ri->GetMeasureWithUnit();
  }
  double value = 0.0;
  const occ::handle<StepRepr_ShapeAspect> aspect = occ::down_cast<StepRepr_ShapeAspect>(u.aspect);
  if (type == nullptr || aspect.IsNull() || !stepLengthMm(magnitude, value) || !(value > 0)) {
    return false;
  }
  std::vector<std::string> targets;
  std::string problem;
  const char* code = "noGeometry";
  bool instanced = false;
  if (!mapPmiAtoms(ctx, stepAspectShapes(*ctx.step, aspect), targets, problem, code, instanced)) {
    pmiIssue(ctx, u.name, code, kLost, std::string(type) + " tolerance not imported: " + problem);
    return true;
  }
  pmiIssue(ctx, u.name, "unsupportedEntity", kApproximated,
           std::string(type) + " tolerance read from the STEP entity without its " +
               (u.why.empty() ? std::string("other parts") : u.why) +
               " (OCCT 8.0.1 cannot read it): the zone applies to the whole feature, without "
               "presentation");
  if (instanced) {
    pmiIssue(ctx, u.name, "instanced", kApproximated,
             "the part is instanced several times; the tolerance is on the first");
  }
  ctx.items.push_back(std::string("{\"kind\":\"tolerance\",\"type\":\"") + type +
                      "\",\"targets\":" + pmiTargetsJson(targets) +
                      ",\"value\":" + jsonNumber(value) + nameMember(u.name) + "}");
  return true;
}

// What OCCT dropped before XCAF: semantic entities it attached to no geometry, dimensions
// without a value, GD&T entities it has no class for, measuring directions it could not match.
void scanStepModelForPmi(PmiImportContext& ctx, STEPCAFControl_Reader& reader, int dimensions,
                         int tolerances) {
  const occ::handle<Interface_InterfaceModel> model = reader.ChangeReader().Model();
  if (model.IsNull()) return;
  int fileDimensions = 0;
  int fileTolerances = 0;
  for (int i = 1; i <= model->NbEntities(); ++i) {
    const occ::handle<Standard_Transient> entity = model->Value(i);
    if (entity.IsNull()) continue;
    if (entity->IsKind(STANDARD_TYPE(StepShape_DimensionalSize)) ||
        entity->IsKind(STANDARD_TYPE(StepShape_DimensionalLocation))) {
      ++fileDimensions;
    } else if (entity->IsKind(STANDARD_TYPE(StepDimTol_GeometricTolerance))) {
      ++fileTolerances;
    }
  }
  // Dimensions the file gives no value: named and typed from the STEP entity.
  int named = 0;
  for (const StepDimensionInfo& d : ctx.stepDims) {
    if (d.hasValue || (d.first.empty() && d.second.empty())) continue;
    ++named;
    pmiIssue(ctx, d.name, "noValue", kLost,
             stepDimensionTypeName(d.type) + " dimension not imported: the file gives it no value");
  }
  for (int i = named; i < ctx.noValueLabels; ++i) {
    pmiIssue(ctx, std::string(), "noValue", kLost, "a dimension not imported: it has no value");
  }
  if (fileDimensions > dimensions) {
    pmiIssue(ctx, std::string(), "notRead", kLost,
             std::to_string(fileDimensions - dimensions) +
                 " dimension(s) of the file could not be read (no geometry they apply to)");
  }
  if (fileTolerances > tolerances) {
    pmiIssue(ctx, std::string(), "notRead", kLost,
             std::to_string(fileTolerances - tolerances) +
                 " geometric tolerance(s) of the file could not be read (no geometry they apply to)");
  }
  if (ctx.step != nullptr) {
    for (const StepUnreadEntity& u : stepUnreadGdt(*ctx.step)) {
      if (importUnreadTolerance(ctx, u)) continue;
      std::string what = u.type.empty() ? u.kind : u.type + " " + u.kind;
      std::string reason = what + " not imported: OCCT 8.0.1 cannot read this entity";
      if (!u.why.empty()) reason += " (a " + u.kind + " with " + u.why + ")";
      pmiIssue(ctx, u.name, "unsupportedEntity", kLost, reason);
    }
  }
  for (const StepDimensionInfo& d : ctx.stepDims) {
    if (d.hasOrientation && d.hasValue && !d.used) {
      pmiIssue(ctx, d.name, "directionNotRead", kApproximated,
               "the measuring direction of a linear distance could not be matched; it comes in "
               "without one");
    }
  }
}

// Sub-shape counts per body, so the TS decoder can range-check every target.
std::string pmiCountsJson(const std::vector<std::unique_ptr<Topo>>& topo) {
  std::string json = "[";
  for (size_t b = 0; b < topo.size(); ++b) {
    if (b > 0) json.push_back(',');
    json += "{\"faces\":" + std::to_string(topo[b]->faces.Extent()) +
            ",\"edges\":" + std::to_string(topo[b]->edges.Extent()) +
            ",\"vertices\":" + std::to_string(topo[b]->vertices.Extent()) + "}";
  }
  return json + "]";
}

// `,"pmi":{…}` holding one issue, when reading the PMI failed as a whole.
std::string pmiFailureMember(const std::vector<std::pair<TopoDS_Shape, std::string>>& bodies,
                             const std::string& reason) {
  std::vector<std::unique_ptr<Topo>> topo;
  for (const auto& body : bodies) topo.push_back(std::make_unique<Topo>(body.first));
  return ",\"pmi\":{\"items\":[],\"issues\":[{\"reason\":" + jsonString(reason) +
         ",\"code\":\"readFailed\",\"severity\":\"lost\"}],\"counts\":" + pmiCountsJson(topo) + "}";
}

std::string stepPmiJson(STEPCAFControl_Reader& reader, const occ::handle<TDocStd_Document>& doc,
                        const std::vector<std::pair<TopoDS_Shape, std::string>>& bodies,
                        const std::string& path) {
  PmiImportContext ctx{bodies, {}, {}, {}};
  ctx.doc = doc;
  int dimensions = 0;
  int tolerances = 0;
  StepPmiModel step;
  try {
    const occ::handle<XCAFDoc_DimTolTool> dimTol = XCAFDoc_DocumentTool::DimTolTool(doc->Main());
    // The body maps are only needed when there is GD&T to place (most STEP files have none). XCAF
    // can be empty while the file has GD&T (datums alone: OCCT reads them only through tolerances).
    if (!dimTol->BaseLabel().HasChild()) {
      bool fileHasGdt = false;
      const occ::handle<Interface_InterfaceModel> model = reader.ChangeReader().Model();
      for (int i = 1; !model.IsNull() && i <= model->NbEntities() && !fileHasGdt; ++i) {
        const occ::handle<Standard_Transient> e = model->Value(i);
        fileHasGdt = isStepGdtEntity(e) || (!e.IsNull() && e->IsKind(STANDARD_TYPE(StepDimTol_Datum)));
      }
      if (!fileHasGdt && !model.IsNull()) {
        StepPmiModel unread;
        unread.model = model;
        fileHasGdt = !stepUnreadGdt(unread).empty();
      }
      if (!fileHasGdt) return std::string();
    }
    for (const auto& body : bodies) ctx.topo.push_back(std::make_unique<Topo>(body.first));
    ctx.angleUnitKnown = stepPlaneAngleUnit(reader, ctx.angleUnitRad);
    step = stepPmiModel(reader, path);
    if (step.valid()) {
      ctx.step = &step;
      ctx.stepDims = stepDimensions(step);
      ctx.stepTols = stepTolerances(step);
    }
    importPmiDatums(ctx, dimTol);
    NCollection_Sequence<TDF_Label> labels;
    dimTol->GetDimensionLabels(labels);
    for (int i = 1; i <= labels.Length(); ++i) {
      occ::handle<XCAFDoc_Dimension> attr;
      if (labels(i).FindAttribute(XCAFDoc_Dimension::GetID(), attr) && !attr->GetObject().IsNull()) {
        const XCAFDimTolObjects_DimensionType t = attr->GetObject()->GetType();
        if (t != XCAFDimTolObjects_DimensionType_DimensionPresentation &&
            t != XCAFDimTolObjects_DimensionType_CommonLabel) {
          ++dimensions;
        }
      }
      importPmiDimension(ctx, labels(i));
    }
    labels.Clear();
    dimTol->GetGeomToleranceLabels(labels);
    tolerances = labels.Length();
    for (int i = 1; i <= labels.Length(); ++i) importPmiTolerance(ctx, labels(i));
    scanStepModelForPmi(ctx, reader, dimensions, tolerances);
  } catch (const Standard_Failure& e) {
    const char* what = e.what();
    pmiIssue(ctx, std::string(), "readFailed", kLost,
             std::string("reading the PMI stopped inside the geometry kernel: ") +
                 e.ExceptionType() + " " + (what != nullptr ? what : ""));
  } catch (const std::exception& e) {
    pmiIssue(ctx, std::string(), "readFailed", kLost, std::string("reading the PMI stopped: ") + e.what());
  }
  if (ctx.items.empty() && ctx.issues.empty()) return std::string();
  if (ctx.topo.size() != bodies.size()) {
    ctx.topo.clear();
    for (const auto& body : bodies) ctx.topo.push_back(std::make_unique<Topo>(body.first));
  }
  std::string json = ",\"pmi\":{\"items\":[";
  for (size_t i = 0; i < ctx.items.size(); ++i) {
    if (i > 0) json.push_back(',');
    json += ctx.items[i];
  }
  json += "],\"issues\":[";
  for (size_t i = 0; i < ctx.issues.size(); ++i) {
    if (i > 0) json.push_back(',');
    json += ctx.issues[i];
  }
  json += "],\"counts\":" + pmiCountsJson(ctx.topo) + "}";
  return json;
}

std::string stepPmiMember(STEPCAFControl_Reader& reader, const occ::handle<TDocStd_Document>& doc,
                          const std::vector<std::pair<TopoDS_Shape, std::string>>& bodies,
                          const std::string& path) noexcept {
  // PMI never fails an import: the bodies come back whatever happens here.
  std::string reason;
  try {
    return stepPmiJson(reader, doc, bodies, path);
  } catch (const Standard_Failure& e) {
    try {
      const char* what = e.what();
      reason = std::string("the PMI could not be read: ") + e.ExceptionType() + " " +
               (what != nullptr ? what : "");
    } catch (...) {
      return std::string();
    }
  } catch (...) {
    try {
      reason = "the PMI could not be read";
    } catch (...) {
      return std::string();
    }
  }
  try {
    return pmiFailureMember(bodies, reason);
  } catch (...) {
    return std::string();
  }
}
