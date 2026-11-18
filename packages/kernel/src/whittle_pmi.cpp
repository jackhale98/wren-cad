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
// issue with what is known. OCCT 8.0.1 reads datums only through the tolerances that reference
// them; a datum of the file that no tolerance uses is listed as an issue (model scan below).

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

struct PmiExportContext {
  const std::vector<ExportItem>& bodies;
  StepDocument& doc;
  occ::handle<XCAFDoc_DimTolTool> dimTol;
  bool presentation = true;
  std::map<std::string, std::string> datumOwner;  // datum label → annotation id
};

struct PmiTargetInput {
  TDF_Label label;
  TopoDS_Shape shape;
};

struct PmiPresentationInput {
  bool present = false;
  gp_Ax2 plane;
  TopoDS_Shape shape;  // null when no polyline survived (nothing to draw)
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
  out.present = true;
  if (edges > 0) out.shape = compound;
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
  applyPmiPresentation(ctx, prs, id, object);
  attr->SetObject(object);
  if (twoSided) {
    ctx.dimTol->SetDimension(labelSequence(targets, 0, 1), labelSequence(targets, 1, 2), dimL);
  } else {
    NCollection_Sequence<TDF_Label> none;
    ctx.dimTol->SetDimension(labelSequence(targets, 0, targets.size()), none, dimL);
  }
}

void exportPmiTolerance(PmiExportContext& ctx, const Json& item, const std::string& id) {
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

  const TDF_Label tolL = ctx.dimTol->AddGeomTolerance();
  nameGdtLabel(tolL, id);
  occ::handle<XCAFDoc_GeomTolerance> attr = XCAFDoc_GeomTolerance::Set(tolL);
  occ::handle<XCAFDimTolObjects_GeomToleranceObject> object =
      new XCAFDimTolObjects_GeomToleranceObject();
  object->SetType(xType);
  object->SetValue(value);
  if (isDiameter) object->SetTypeOfValue(XCAFDimTolObjects_GeomToleranceTypeValue_Diameter);
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
                                          PmiExportReportData& report) {
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
          exportPmiTolerance(ctx, item, id);
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
  return written;
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
  const std::vector<std::string> written =
      addPmiToDocument(bodies, doc, items, presentation, out.report);
  std::string failure;
  try {
    out.path = writeStepDocument(doc.doc, params);
    return out;
  } catch (const Standard_Failure& e) {
    const char* what = e.what();
    failure = std::string(e.ExceptionType()) + ": " + (what != nullptr ? what : "");
  } catch (const FacadeError& e) {
    failure = e.error().message;
  }
  // The writer failed with the GD&T in the document: write the geometry alone and report every
  // annotation as not exported, rather than failing the whole export.
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

struct PmiImportContext {
  const std::vector<std::pair<TopoDS_Shape, std::string>>& bodies;
  std::vector<std::unique_ptr<Topo>> topo;
  std::vector<std::string> items;   // PmiImportItem JSON
  std::vector<std::string> issues;  // {name?, reason} JSON
};

void pmiIssue(PmiImportContext& ctx, const std::string& name, const std::string& reason) {
  std::string json = "{";
  if (!name.empty()) json += "\"name\":" + jsonString(name) + ",";
  json += "\"reason\":" + jsonString(reason) + "}";
  ctx.issues.push_back(std::move(json));
}

const ShapeMap& topoMap(const Topo& topo, TopAbs_ShapeEnum kind) {
  return kind == TopAbs_FACE ? topo.faces : kind == TopAbs_EDGE ? topo.edges : topo.vertices;
}

const char* kindName(TopAbs_ShapeEnum kind) {
  return kind == TopAbs_FACE ? "face" : kind == TopAbs_EDGE ? "edge" : "vertex";
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

// The targets of GD&T shape labels. False (with `problem`) when any of them cannot be mapped:
// an item on fewer faces than the file says would be a silent guess.
bool mapPmiLabels(PmiImportContext& ctx, const NCollection_Sequence<TDF_Label>& labels,
                  std::vector<std::string>& targets, std::string& problem, bool& instanced) {
  for (int i = 1; i <= labels.Length(); ++i) {
    const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(labels(i));
    if (shape.IsNull()) {
      problem = "a referenced shape is empty";
      return false;
    }
    std::vector<TopoDS_Shape> atoms;
    switch (shape.ShapeType()) {
      case TopAbs_FACE:
      case TopAbs_EDGE:
      case TopAbs_VERTEX:
        atoms.push_back(shape);
        break;
      case TopAbs_WIRE:
        for (TopExp_Explorer ex(shape, TopAbs_EDGE); ex.More(); ex.Next()) atoms.push_back(ex.Current());
        break;
      case TopAbs_SHELL:
      case TopAbs_COMPOUND:
        for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) atoms.push_back(ex.Current());
        if (atoms.empty()) {
          for (TopExp_Explorer ex(shape, TopAbs_EDGE); ex.More(); ex.Next()) atoms.push_back(ex.Current());
        }
        break;
      default:
        problem = "it applies to a whole body, not to faces, edges or vertices";
        return false;
    }
    if (atoms.empty()) {
      problem = "a referenced shape holds no faces or edges";
      return false;
    }
    for (const TopoDS_Shape& atom : atoms) {
      std::string json;
      if (!mapPmiSubShape(ctx, atom, json, instanced)) {
        problem = std::string("a ") + kindName(atom.ShapeType()) +
                  " it applies to is not part of the imported bodies";
        return false;
      }
      if (std::find(targets.begin(), targets.end(), json) == targets.end()) targets.push_back(json);
    }
  }
  if (targets.empty()) {
    problem = "it is attached to no geometry";
    return false;
  }
  return true;
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
std::vector<std::vector<gp_Pnt>> pmiPolylines(const TopoDS_Shape& prs, bool& hasFaces) {
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
  hasFaces = TopExp_Explorer(prs, TopAbs_FACE).More();
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
                                  const std::string& name, bool& hasPolylines) {
  hasPolylines = false;
  const TopoDS_Shape prs = object->GetPresentation();
  if (prs.IsNull()) return std::string();
  bool hasFaces = false;
  const std::vector<std::vector<gp_Pnt>> lines = pmiPolylines(prs, hasFaces);
  if (hasFaces) {
    pmiIssue(ctx, name, "filled (triangulated) presentation areas are not imported; lines are");
  }
  if (lines.empty()) return std::string();
  gp_Ax2 plane;
  if (object->HasPlane()) {
    plane = object->GetPlane();
  } else {
    plane = gp_Ax2(object->GetPointTextAttach(), gp::DZ(), gp::DX());
    pmiIssue(ctx, name, "the presentation has no annotation plane; it is placed on the XY plane");
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
  json += "]}";
  hasPolylines = true;
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

void importPmiPresentationOnly(PmiImportContext& ctx,
                               const occ::handle<XCAFDimTolObjects_DimensionObject>& object,
                               const std::string& name) {
  bool hasPolylines = false;
  const std::string prs = pmiPresentationMember(ctx, object, name, hasPolylines);
  if (!hasPolylines) {
    pmiIssue(ctx, name, "a presentation-only annotation has no lines to show");
    return;
  }
  ctx.items.push_back("{\"kind\":\"presentationOnly\"" + nameMember(name) + prs + "}");
}

void importPmiDimension(PmiImportContext& ctx, const TDF_Label& label) {
  occ::handle<XCAFDoc_Dimension> attr;
  if (!label.FindAttribute(XCAFDoc_Dimension::GetID(), attr)) return;
  const occ::handle<XCAFDimTolObjects_DimensionObject> object = attr->GetObject();
  if (object.IsNull()) {
    pmiIssue(ctx, pmiLabelName(label), "a dimension without data");
    return;
  }
  const XCAFDimTolObjects_DimensionType type = object->GetType();
  const std::string name = pmiItemName(object, std::string());
  if (type == XCAFDimTolObjects_DimensionType_DimensionPresentation ||
      type == XCAFDimTolObjects_DimensionType_CommonLabel) {
    importPmiPresentationOnly(ctx, object, name);
    return;
  }
  const std::string typeName = pmiDimensionTypeName(type);
  NCollection_Sequence<TDF_Label> first;
  NCollection_Sequence<TDF_Label> second;
  XCAFDoc_DimTolTool::GetRefShapeLabel(label, first, second);
  NCollection_Sequence<TDF_Label> all = first;
  all.Append(second);
  std::vector<std::string> targets;
  std::string problem;
  bool instanced = false;
  if (!mapPmiLabels(ctx, all, targets, problem, instanced)) {
    pmiIssue(ctx, name, typeName + " dimension not imported: " + problem);
    return;
  }
  if (instanced) {
    pmiIssue(ctx, name, "the part is instanced several times; the dimension is on the first");
  }
  const bool angular = typeName == "angular";
  // OCCT's reader gives angles in degrees; the contracts use radians.
  const double scale = angular ? kPi / 180.0 : 1.0;
  const occ::handle<NCollection_HArray1<double>> values = object->GetValues();
  if (values.IsNull() || values->Length() == 0) {
    pmiIssue(ctx, name, typeName + " dimension not imported: it has no value");
    return;
  }
  double value = object->GetValue() * scale;
  std::string tolerance;
  if (object->IsDimWithRange()) {
    const double lo = object->GetLowerBound() * scale;
    const double hi = object->GetUpperBound() * scale;
    value = 0.5 * (lo + hi);
    tolerance = ",\"tolerance\":{\"kind\":\"deviation\",\"upper\":" + jsonNumber(hi - value) +
                ",\"lower\":" + jsonNumber(lo - value) + "}";
  } else if (object->IsDimWithPlusMinusTolerance()) {
    tolerance = ",\"tolerance\":{\"kind\":\"deviation\",\"upper\":" +
                jsonNumber(object->GetUpperTolValue() * scale) +
                ",\"lower\":" + jsonNumber(-object->GetLowerTolValue() * scale) + "}";
  }
  bool hole = false;
  XCAFDimTolObjects_DimensionFormVariance variance = XCAFDimTolObjects_DimensionFormVariance_None;
  XCAFDimTolObjects_DimensionGrade grade = XCAFDimTolObjects_DimensionGrade_IT01;
  if (object->GetClassOfTolerance(hole, variance, grade)) {
    const std::string cls = fitClassText(hole, variance, grade);
    if (cls.empty()) {
      pmiIssue(ctx, name, "the dimension's class of tolerance is not an ISO 286 class");
    } else if (!tolerance.empty()) {
      pmiIssue(ctx, name, "the dimension has deviations and a class " + cls + "; the class is dropped");
    } else {
      tolerance = std::string(",\"tolerance\":{\"kind\":\"fit\",\"") + (hole ? "hole" : "shaft") +
                  "\":" + jsonString(cls) + "}";
    }
  }
  if (object->GetModifiers().Length() > 0 || object->HasQualifier()) {
    pmiIssue(ctx, name, "dimension modifiers and qualifiers (min, max, …) are not imported");
  }
  if (type == XCAFDimTolObjects_DimensionType_Size_SphericalDiameter ||
      type == XCAFDimTolObjects_DimensionType_Size_SphericalRadius) {
    pmiIssue(ctx, name, "a spherical size is imported as a plain diameter or radius");
  }
  bool hasPolylines = false;
  const std::string prs = pmiPresentationMember(ctx, object, name, hasPolylines);
  ctx.items.push_back("{\"kind\":\"dimension\",\"type\":\"" + typeName + "\",\"targets\":" +
                      pmiTargetsJson(targets) + ",\"value\":" + jsonNumber(value) + tolerance +
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
  if (!label.FindAttribute(XCAFDoc_GeomTolerance::GetID(), attr)) return;
  const occ::handle<XCAFDimTolObjects_GeomToleranceObject> object = attr->GetObject();
  if (object.IsNull()) {
    pmiIssue(ctx, pmiLabelName(label), "a geometric tolerance without data");
    return;
  }
  const std::string name = pmiItemName(object, pmiLabelName(label));
  const char* type = pmiToleranceTypeName(object->GetType());
  if (type == nullptr) {
    pmiIssue(ctx, name, "a geometric tolerance of unknown type");
    return;
  }
  NCollection_Sequence<TDF_Label> first;
  NCollection_Sequence<TDF_Label> second;
  XCAFDoc_DimTolTool::GetRefShapeLabel(label, first, second);
  first.Append(second);
  std::vector<std::string> targets;
  std::string problem;
  bool instanced = false;
  if (!mapPmiLabels(ctx, first, targets, problem, instanced)) {
    pmiIssue(ctx, name, std::string(type) + " tolerance not imported: " + problem);
    return;
  }
  if (instanced) {
    pmiIssue(ctx, name, "the part is instanced several times; the tolerance is on the first");
  }
  std::string json = std::string("{\"kind\":\"tolerance\",\"type\":\"") + type +
                     "\",\"targets\":" + pmiTargetsJson(targets) +
                     ",\"value\":" + jsonNumber(object->GetValue());
  const XCAFDimTolObjects_GeomToleranceTypeValue zone = object->GetTypeOfValue();
  if (zone == XCAFDimTolObjects_GeomToleranceTypeValue_Diameter ||
      zone == XCAFDimTolObjects_GeomToleranceTypeValue_SphericalDiameter) {
    json += ",\"diameter\":true";
    if (zone == XCAFDimTolObjects_GeomToleranceTypeValue_SphericalDiameter) {
      pmiIssue(ctx, name, "a spherical tolerance zone is imported as a cylindrical one");
    }
  }
  const XCAFDimTolObjects_GeomToleranceMatReqModif mat = object->GetMaterialRequirementModifier();
  if (mat == XCAFDimTolObjects_GeomToleranceMatReqModif_M) json += ",\"material\":\"M\"";
  if (mat == XCAFDimTolObjects_GeomToleranceMatReqModif_L) json += ",\"material\":\"L\"";
  if (object->GetModifiers().Length() > 0 ||
      object->GetZoneModifier() != XCAFDimTolObjects_GeomToleranceZoneModif_None ||
      object->GetMaxValueModifier() != 0.0) {
    pmiIssue(ctx, name,
             "tolerance modifiers (projected, free state, all around, maximum value, …) are not "
             "imported");
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
      pmiIssue(ctx, name, "a datum reference without a label is not imported");
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
  if (otherModifiers) {
    pmiIssue(ctx, name, "datum reference modifiers other than M and L are not imported");
  }
  if (refs.size() > 3) {
    pmiIssue(ctx, name, "a datum reference frame of more than three datums; the first three are kept");
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
  bool hasPolylines = false;
  json += nameMember(name) + pmiPresentationMember(ctx, object, name, hasPolylines) + "}";
  ctx.items.push_back(std::move(json));
}

// Datums: OCCT creates one datum label per tolerance reference; a datum item is the label (by
// name) with geometry, plus the first presentation found among its labels.
void importPmiDatums(PmiImportContext& ctx, const occ::handle<XCAFDoc_DimTolTool>& dimTol,
                     std::set<std::string>& read) {
  NCollection_Sequence<TDF_Label> labels;
  dimTol->GetDatumLabels(labels);
  std::vector<std::string> order;
  std::map<std::string, std::vector<TDF_Label>> byName;
  for (int i = 1; i <= labels.Length(); ++i) {
    occ::handle<XCAFDoc_Datum> attr;
    if (!labels(i).FindAttribute(XCAFDoc_Datum::GetID(), attr)) continue;
    const occ::handle<XCAFDimTolObjects_DatumObject> datum = attr->GetObject();
    if (datum.IsNull()) continue;
    const std::string label = hasciiText(datum->GetName());
    if (datum->IsDatumTarget()) {
      pmiIssue(ctx, label + std::to_string(datum->GetDatumTargetNumber()),
               "datum targets (points, lines, areas) are not imported");
      continue;
    }
    if (label.empty()) {
      pmiIssue(ctx, std::string(), "a datum without a label is not imported");
      continue;
    }
    if (byName.find(label) == byName.end()) order.push_back(label);
    byName[label].push_back(labels(i));
  }
  for (const std::string& label : order) {
    read.insert(label);
    std::vector<std::string> targets;
    std::string problem = "it is attached to no geometry";
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
          mapped = mapPmiLabels(ctx, first, targets, problem, instanced);
        }
      }
      if (prs.empty()) {
        const std::string n = pmiItemName(datum, std::string());
        bool hasPolylines = false;
        prs = pmiPresentationMember(ctx, datum, n.empty() ? label : n, hasPolylines);
        if (hasPolylines || name.empty()) name = n;
      }
    }
    if (!mapped) {
      pmiIssue(ctx, name.empty() ? label : name, "datum " + label + " not imported: " + problem);
      continue;
    }
    if (instanced) {
      pmiIssue(ctx, name.empty() ? label : name,
               "the part is instanced several times; the datum is on the first");
    }
    ctx.items.push_back("{\"kind\":\"datum\",\"label\":" + jsonString(label) + ",\"targets\":" +
                        pmiTargetsJson(targets) + nameMember(name) + prs + "}");
  }
}

// What OCCT dropped before XCAF: semantic entities it attached to no geometry, and datums that
// no tolerance references (OCCT 8.0.1 reads datums only through tolerances).
void scanStepModelForPmi(PmiImportContext& ctx, STEPCAFControl_Reader& reader, int dimensions,
                         int tolerances, const std::set<std::string>& datums) {
  const occ::handle<Interface_InterfaceModel> model = reader.ChangeReader().Model();
  if (model.IsNull()) return;
  int fileDimensions = 0;
  int fileTolerances = 0;
  std::vector<std::string> fileDatums;
  for (int i = 1; i <= model->NbEntities(); ++i) {
    const occ::handle<Standard_Transient> entity = model->Value(i);
    if (entity.IsNull()) continue;
    if (entity->IsKind(STANDARD_TYPE(StepShape_DimensionalSize)) ||
        entity->IsKind(STANDARD_TYPE(StepShape_DimensionalLocation))) {
      ++fileDimensions;
    } else if (entity->IsKind(STANDARD_TYPE(StepDimTol_GeometricTolerance))) {
      ++fileTolerances;
    } else if (entity->IsKind(STANDARD_TYPE(StepDimTol_Datum))) {
      const std::string id =
          hasciiText(occ::down_cast<StepDimTol_Datum>(entity)->Identification());
      if (std::find(fileDatums.begin(), fileDatums.end(), id) == fileDatums.end()) {
        fileDatums.push_back(id);
      }
    }
  }
  if (fileDimensions > dimensions) {
    pmiIssue(ctx, std::string(),
             std::to_string(fileDimensions - dimensions) +
                 " dimension(s) of the file could not be read (no geometry they apply to)");
  }
  if (fileTolerances > tolerances) {
    pmiIssue(ctx, std::string(),
             std::to_string(fileTolerances - tolerances) +
                 " geometric tolerance(s) of the file could not be read (no geometry they apply to)");
  }
  for (const std::string& id : fileDatums) {
    if (datums.count(id) == 0) {
      pmiIssue(ctx, id,
               "datum " + id +
                   " is not imported: it is referenced by no tolerance that could be read");
    }
  }
}

std::string stepPmiJson(STEPCAFControl_Reader& reader, const occ::handle<TDocStd_Document>& doc,
                        const std::vector<std::pair<TopoDS_Shape, std::string>>& bodies) {
  PmiImportContext ctx{bodies, {}, {}, {}};
  for (const auto& body : bodies) ctx.topo.push_back(std::make_unique<Topo>(body.first));
  int dimensions = 0;
  int tolerances = 0;
  std::set<std::string> datums;
  try {
    const occ::handle<XCAFDoc_DimTolTool> dimTol = XCAFDoc_DocumentTool::DimTolTool(doc->Main());
    importPmiDatums(ctx, dimTol, datums);
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
    scanStepModelForPmi(ctx, reader, dimensions, tolerances, datums);
  } catch (const Standard_Failure& e) {
    const char* what = e.what();
    pmiIssue(ctx, std::string(),
             std::string("reading the PMI stopped inside the geometry kernel: ") +
                 e.ExceptionType() + " " + (what != nullptr ? what : ""));
  } catch (const std::exception& e) {
    pmiIssue(ctx, std::string(), std::string("reading the PMI stopped: ") + e.what());
  }
  if (ctx.items.empty() && ctx.issues.empty()) return std::string();
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
  // Sub-shape counts per body, so the TS decoder can range-check every target.
  json += "],\"counts\":[";
  for (size_t b = 0; b < ctx.topo.size(); ++b) {
    if (b > 0) json.push_back(',');
    json += "{\"faces\":" + std::to_string(ctx.topo[b]->faces.Extent()) +
            ",\"edges\":" + std::to_string(ctx.topo[b]->edges.Extent()) +
            ",\"vertices\":" + std::to_string(ctx.topo[b]->vertices.Extent()) + "}";
  }
  json += "]}";
  return json;
}

std::string stepPmiMember(STEPCAFControl_Reader& reader, const occ::handle<TDocStd_Document>& doc,
                          const std::vector<std::pair<TopoDS_Shape, std::string>>& bodies) noexcept {
  // PMI never fails an import: the bodies come back whatever happens here.
  try {
    return stepPmiJson(reader, doc, bodies);
  } catch (const Standard_Failure& e) {
    try {
      const char* what = e.what();
      return ",\"pmi\":{\"items\":[],\"issues\":[{\"reason\":" +
             jsonString(std::string("the PMI could not be read: ") + e.ExceptionType() + " " +
                        (what != nullptr ? what : "")) +
             "}],\"counts\":[]}";
    } catch (...) {
      return std::string();
    }
  } catch (...) {
    try {
      return std::string(",\"pmi\":{\"items\":[],\"issues\":[{\"reason\":\"the PMI could not be "
                         "read\"}],\"counts\":[]}");
    } catch (...) {
      return std::string();
    }
  }
}
