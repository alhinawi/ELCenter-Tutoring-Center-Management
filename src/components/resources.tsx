"use client";
import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  Plus,
  Package,
  Library,
  FileText,
  LifeBuoy,
  BarChart3,
  Download,
} from "lucide-react";
import { Button, Card, Field, Input, Select, inputClass } from "./ui";
import { Dialog, Panel, Table, Badge } from "./portals";
import { ReportSchedules } from "./system-controls";
import { printRecord } from "./finance-extra";
import type { T } from "./i18n";
type Row = Record<string, any>;
type Api = (p: string, m?: string, b?: unknown) => Promise<any>;
type Props = {
  t: T;
  api: Api;
  toast: (s: string) => void;
  allowed: (r: string, a?: string) => boolean;
  currency: string;
  timezone: string;
};
type Def = {
  key: string;
  en: string;
  ar: string;
  type?: string;
  source?: string;
  options?: string[];
  optional?: boolean;
};
const f = (
  key: string,
  en: string,
  ar: string,
  type = "text",
  source?: string,
  options?: string[],
): Def => ({ key, en, ar, type, source, options });
const branch = f("branch_id", "Branch", "الفرع", "select", "branches"),
  item = f("item_id", "Item", "الصنف", "select", "items"),
  student = f("student_id", "Student", "الطالب", "select", "students"),
  quantity = f("quantity", "Quantity", "الكمية", "number"),
  name = f("name", "Name", "الاسم"),
  status = f("status", "Status", "الحالة", "select", undefined, [
    "active",
    "inactive",
  ]);
const defs: Record<string, Def[]> = {
  items: [
    f("sku", "SKU", "كود الصنف"),
    name,
    f("category", "Category", "التصنيف"),
    f("unit", "Unit", "الوحدة"),
    f("unit_cost", "Standard unit cost", "التكلفة المعيارية للوحدة", "number"),
    f("sale_price", "List sale price", "سعر البيع", "number"),
    f("reorder_level", "Low-stock threshold", "حد إعادة الطلب", "number"),
    status,
  ],
  suppliers: [
    branch,
    name,
    { ...f("email", "Email", "الإيميل", "email"), optional: true },
    { ...f("phone", "Phone", "التليفون"), optional: true },
    { ...f("address", "Address", "العنوان"), optional: true },
  ],
  adjustments: [
    branch,
    item,
    quantity,
    f("reason", "Count adjustment reason", "سبب تسوية الجرد"),
  ],
  purchases: [
    branch,
    f("supplier_id", "Supplier", "المورد", "select", "suppliers"),
    f("number", "Order number", "رقم أمر الشراء"),
    f("date", "Date", "التاريخ", "date"),
    item,
    quantity,
    f("unit_cost", "Unit cost", "تكلفة الوحدة", "number"),
  ],
  transfers: [
    f("from_branch", "From branch", "من فرع", "select", "branches"),
    f("to_branch", "To branch", "إلى فرع", "select", "branches"),
    item,
    quantity,
  ],
  sales: [
    f("invoice_id", "Issued invoice", "الفاتورة الصادرة", "select", "invoices"),
    item,
    quantity,
    f(
      "unit_price",
      "Invoice-covered unit price",
      "سعر الوحدة المغطى بالفاتورة",
      "number",
    ),
  ],
  assets: [
    branch,
    { ...item, optional: true },
    f("code", "Asset code", "كود الأصل"),
    name,
    { ...f("serial", "Serial number", "الرقم المسلسل"), optional: true },
    { ...f("location", "Location", "المكان"), optional: true },
    {
      ...f("purchased_on", "Purchase date", "تاريخ الشراء", "date"),
      optional: true,
    },
    f("value", "Recorded asset value", "قيمة الأصل المسجلة", "number"),
  ],
  books: [
    f("title", "Title", "العنوان"),
    f("author", "Author", "المؤلف"),
    { ...f("isbn", "ISBN", "الترقيم الدولي"), optional: true },
    f("category", "Category", "التصنيف"),
    { ...f("description", "Description", "الوصف"), optional: true },
  ],
  copies: [
    branch,
    f("book_id", "Book", "الكتاب", "select", "books"),
    f("barcode", "Copy barcode", "باركود النسخة"),
  ],
  loans: [
    f("copy_id", "Available copy", "النسخة المتاحة", "select", "copies"),
    student,
    f("borrowed_on", "Borrowed on", "تاريخ الاستعارة", "date"),
    f("due_on", "Due on", "تاريخ الاستحقاق", "date"),
    f(
      "daily_penalty",
      "Recorded daily late penalty",
      "غرامة التأخير اليومية المسجلة",
      "number",
    ),
    { ...f("notes", "Notes", "ملاحظات"), optional: true },
  ],
  reservations: [f("book_id", "Book", "الكتاب", "select", "books"), student],
};
const paths: Record<string, string> = {
  items: "/inventory/inventory_items",
  suppliers: "/inventory/suppliers",
  stock: "/inventory/stock",
  movements: "/inventory/movements",
  adjustments: "/inventory/adjustments",
  purchases: "/inventory/purchases",
  transfers: "/inventory/transfers",
  sales: "/inventory/sales",
  assets: "/inventory/assets",
  books: "/library/books",
  copies: "/library/copies",
  loans: "/library/loans",
  reservations: "/library/reservations",
};
const labels: Record<string, [string, string]> = {
  items: ["Item catalog", "دليل الأصناف"],
  suppliers: ["Suppliers", "الموردون"],
  stock: ["Stock & valuation", "المخزون والتقييم"],
  movements: ["Movement history", "حركة المخزون"],
  purchases: ["Purchase orders", "أوامر الشراء"],
  transfers: ["Branch transfers", "التحويلات بين الفروع"],
  sales: ["Goods dispatch", "تسليم المبيعات"],
  assets: ["Assets", "الأصول"],
  books: ["Book catalog", "دليل الكتب"],
  copies: ["Physical copies", "نسخ الكتب"],
  loans: ["Borrowing & returns", "الاستعارة والمرتجعات"],
  reservations: ["Reservations", "الحجوزات"],
};
function Form({
  title,
  fields,
  options,
  initial = {},
  submit,
  ar,
}: {
  title: string;
  fields: Def[];
  options: Record<string, Row[]>;
  initial?: Row;
  submit: (d: Row) => Promise<void>;
  ar: boolean;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} />
        {title}
      </Button>
      {open && (
        <Dialog title={title} close={() => setOpen(false)}>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget),
                d: Row = {};
              for (const x of fields) {
                const v = String(fd.get(x.key) ?? "");
                d[x.key] = x.type === "number" ? Number(v) : v;
              }
              setBusy(true);
              try {
                await submit(d);
                setOpen(false);
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {fields.map((x) => (
              <Field label={ar ? x.ar : x.en} key={x.key}>
                {x.type === "select" ? (
                  <Select
                    aria-label={ar ? x.ar : x.en}
                    required={!x.optional}
                    name={x.key}
                    defaultValue={initial[x.key] ?? ""}
                  >
                    <option value="">{ar ? "اختر" : "Select"}</option>
                    {x.source
                      ? (options[x.source] ?? []).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name ||
                              r.title ||
                              r.barcode ||
                              r.number ||
                              r.email}
                            {r.code ? " · " + r.code : ""}
                          </option>
                        ))
                      : x.options?.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                  </Select>
                ) : (
                  <Input
                    name={x.key}
                    type={x.type ?? "text"}
                    required={!x.optional}
                    defaultValue={
                      initial[x.key] ?? (x.type === "number" ? 0 : "")
                    }
                  />
                )}
              </Field>
            ))}
            {error && (
              <p
                className="col-span-full rounded-xl bg-red-50 p-3 text-sm text-red-700"
                role="alert"
              >
                {error}
              </p>
            )}
            <Button className="col-span-full" type="submit" disabled={busy}>
              {ar ? "حفظ" : "Save"}
            </Button>
          </form>
        </Dialog>
      )}
    </>
  );
}
export default function Resources(p: Props) {
  const ar = p.t.language === "English",
    L = (e: string, a: string) => (ar ? a : e);
  const [area, setArea] = useState(
      ["inventory", "library", "documents", "support", "reports"].find((r) =>
        p.allowed(r),
      ) ?? "inventory",
    ),
    [tab, setTab] = useState(p.allowed("inventory") ? "stock" : "books"),
    [rows, setRows] = useState<Row[]>([]),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<Row | null>(null);
  const resource = area === "library" ? "library" : "inventory",
    money = (v: number) =>
      new Intl.NumberFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", {
        maximumFractionDigits: 0,
      }).format(v) +
      " " +
      p.currency;
  const tabs =
    area === "library"
      ? ["books", "copies", "loans", "reservations"]
      : [
          "stock",
          "items",
          "movements",
          "suppliers",
          "purchases",
          "transfers",
          "sales",
          "assets",
        ];
  async function load() {
    try {
      setError("");
      if (!["inventory", "library"].includes(area)) return;
      setRows((await p.api(paths[tab])).data);
      const o: Record<string, Row[]> = await p.api("/resource-options");
      const requests: Record<string, string> = {
        branches: "/branches",
        items: paths.items,
        students: "/students",
        employees: "/operations/employees",
        invoices: "/invoices",
        suppliers: paths.suppliers,
        books: paths.books,
        copies: paths.copies,
      };
      const needed = new Set(
        (defs[tab === "stock" ? "adjustments" : tab] ?? [])
          .map((f) => f.source)
          .filter(Boolean) as string[],
      );
      if (tab === "assets") needed.add("employees");
      for (const key of needed) {
        if (o[key]) continue;
        if (
          (key === "students" && !p.allowed("students")) ||
          (key === "employees" && !p.allowed("hr")) ||
          (key === "invoices" && !p.allowed("finance"))
        )
          continue;
        const r = await p.api(requests[key]);
        o[key] = r.data;
        if (key === "invoices")
          o[key] = r.data.filter((x: Row) => x.status === "issued");
        if (key === "copies")
          o[key] = r.data.filter((x: Row) => x.status === "available");
      }
      setOptions(o);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, [area, tab]);
  async function action(path: string, body?: Row) {
    try {
      await p.api(path, "POST", body ?? {});
      await load();
      p.toast(p.t.saved);
    } catch (e) {
      setError(String(e));
    }
  }
  const create = defs[tab] && p.allowed(resource, "create");
  async function save(d: Row) {
    if (["purchases", "sales"].includes(tab)) {
      const { item_id, quantity, unit_cost, unit_price, ...head } = d;
      d = {
        ...head,
        lines: [
          {
            item_id,
            quantity,
            ...(tab === "purchases" ? { unit_cost } : { unit_price }),
          },
        ],
      };
    }
    await p.api(paths[tab], "POST", d);
    await load();
    p.toast(p.t.saved);
  }
  const columns: Record<string, string[]> = {
    stock: [
      "branch_name",
      "name",
      "quantity",
      "unit",
      "unit_cost",
      "valuation",
      "low_stock",
    ],
    items: [
      "sku",
      "name",
      "category",
      "unit_cost",
      "sale_price",
      "reorder_level",
      "status",
    ],
    movements: ["branch_name", "item_name", "kind", "quantity", "reason"],
    suppliers: ["name", "email", "phone", "status"],
    purchases: ["number", "supplier_name", "date", "total", "status"],
    transfers: ["item_name", "from_name", "to_name", "quantity", "status"],
    sales: ["invoice_number", "student_name", "total", "status"],
    assets: ["code", "name", "serial", "location", "status"],
    books: ["title", "author", "isbn", "category", "copies", "available"],
    copies: ["title", "barcode", "branch_name", "status"],
    loans: ["title", "student_name", "due_on", "returned_on", "penalty_total"],
    reservations: ["title", "student_name", "branch_name", "status"],
  };
  const colLabel: Record<string, string> = {
    branch_name: L("Branch", "الفرع"),
    name: L("Name", "الاسم"),
    quantity: L("Quantity", "الكمية"),
    unit: L("Unit", "الوحدة"),
    unit_cost: L("Unit cost", "تكلفة الوحدة"),
    valuation: L("Standard-cost value", "القيمة بالتكلفة المعيارية"),
    low_stock: L("Low stock", "مخزون منخفض"),
    sku: L("SKU", "كود الصنف"),
    category: L("Category", "التصنيف"),
    sale_price: L("List price", "سعر البيع"),
    reorder_level: L("Reorder at", "حد الطلب"),
    status: L("Status", "الحالة"),
    item_name: L("Item", "الصنف"),
    kind: L("Type", "النوع"),
    reason: L("Reason", "السبب"),
    email: L("Email", "الإيميل"),
    phone: L("Phone", "التليفون"),
    number: L("Number", "الرقم"),
    supplier_name: L("Supplier", "المورد"),
    date: L("Date", "التاريخ"),
    total: L("Total", "الإجمالي"),
    from_name: L("From", "من"),
    to_name: L("To", "إلى"),
    invoice_number: L("Invoice", "الفاتورة"),
    student_name: L("Student", "الطالب"),
    code: L("Code", "الكود"),
    serial: L("Serial", "المسلسل"),
    location: L("Location", "المكان"),
    title: L("Title", "العنوان"),
    author: L("Author", "المؤلف"),
    isbn: "ISBN",
    copies: L("Copies", "النسخ"),
    available: L("Available", "المتاح"),
    barcode: L("Barcode", "الباركود"),
    due_on: L("Due on", "الاستحقاق"),
    returned_on: L("Returned", "الإرجاع"),
    penalty_total: L("Recorded penalty", "الغرامة المسجلة"),
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {L("Resources & service desk", "الموارد وخدمة العملاء")}
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          {L(
            "Track physical resources, keep records private and close the loop on support.",
            "تابع الموارد واحفظ الملفات بخصوصية وتابع طلبات الدعم للنهاية.",
          )}
        </p>
      </div>
      <nav className="flex flex-wrap gap-2">
        {[
          ["inventory", Package, L("Inventory", "المخزون")],
          ["library", Library, L("Library", "المكتبة")],
          ["documents", FileText, L("Documents", "المستندات")],
          ["support", LifeBuoy, L("Support", "الدعم")],
          ["reports", BarChart3, L("Reports", "التقارير")],
        ]
          .filter(([k]) => p.allowed(String(k)))
          .map(([k, Icon, label]) => {
            const I = Icon as typeof Package;
            return (
              <button
                key={String(k)}
                className={
                  "flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium " +
                  (area === k
                    ? "bg-blue-700 text-white"
                    : "bg-white text-slate-500 dark:bg-slate-900")
                }
                onClick={() => {
                  setArea(String(k));
                  if (k === "inventory") setTab("stock");
                  if (k === "library") setTab("books");
                }}
              >
                <I size={18} />
                {String(label)}
              </button>
            );
          })}
      </nav>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {area === "documents" ? (
        <Documents {...p} />
      ) : area === "support" ? (
        <Support {...p} />
      ) : area === "reports" ? (
        <Reports {...p} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-white p-1 dark:bg-slate-900">
              {tabs.map((k) => (
                <button
                  key={k}
                  className={
                    "whitespace-nowrap rounded-lg px-3 py-2.5 text-sm " +
                    (tab === k
                      ? "bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950"
                      : "text-slate-500")
                  }
                  onClick={() => setTab(k)}
                >
                  {labels[k][ar ? 1 : 0]}
                </button>
              ))}
            </div>
            {create && (
              <Form
                title={L("New record", "سجل جديد")}
                fields={defs[tab]}
                options={options}
                ar={ar}
                initial={{
                  unit: "unit",
                  status: "active",
                  quantity: 1,
                  borrowed_on: new Date().toISOString().slice(0, 10),
                }}
                submit={save}
              />
            )}{" "}
            {tab === "stock" && p.allowed("inventory", "edit") && (
              <Form
                title={L("Record stock adjustment", "تسجيل تسوية مخزون")}
                fields={defs.adjustments}
                options={options}
                ar={ar}
                submit={async (d) => {
                  await p.api(paths.adjustments, "POST", {
                    ...d,
                    idempotency_key: crypto.randomUUID(),
                  });
                  await load();
                }}
              />
            )}
          </div>
          <Card className="overflow-hidden">
            <Table
              heads={[
                ...(columns[tab] ?? []).map((c) => colLabel[c] ?? c),
                L("Actions", "الإجراءات"),
              ]}
              rows={rows.map((r) => [
                ...(columns[tab] ?? []).map((k) =>
                  [
                    "unit_cost",
                    "valuation",
                    "total",
                    "penalty_total",
                    "sale_price",
                  ].includes(k) ? (
                    money(r[k])
                  ) : k === "status" ? (
                    <Badge value={r[k]} ar={ar} />
                  ) : k === "low_stock" ? (
                    r[k] ? (
                      L("Reorder", "إعادة الطلب")
                    ) : (
                      "—"
                    )
                  ) : (
                    (r[k] ?? "—")
                  ),
                ),
                <div className="flex flex-wrap gap-2">
                  {tab === "books" && p.allowed("library", "edit") && (
                    <Form
                      title={L("Edit book", "تعديل الكتاب")}
                      ar={ar}
                      fields={[
                        ...defs.books,
                        f("status", "Status", "الحالة", "select", undefined, [
                          "active",
                          "archived",
                        ]),
                      ]}
                      options={options}
                      initial={r}
                      submit={async (d) => {
                        await p.api(paths.books + "/" + r.id, "PUT", d);
                        await load();
                      }}
                    />
                  )}
                  {tab === "copies" &&
                    p.allowed("library", "edit") &&
                    !["loaned", "retired"].includes(r.status) && (
                      <Form
                        title={L("Copy condition", "حالة النسخة")}
                        ar={ar}
                        fields={[
                          f("status", "Status", "الحالة", "select", undefined, [
                            "available",
                            "maintenance",
                            "lost",
                            "retired",
                          ]),
                        ]}
                        initial={r}
                        options={options}
                        submit={async (d) => {
                          await p.api(paths.copies + "/" + r.id, "PUT", d);
                          await load();
                        }}
                      />
                    )}
                  {tab === "purchases" && (
                    <>
                      <button
                        className="text-blue-700"
                        onClick={() =>
                          void p
                            .api(paths.purchases + "/" + r.id)
                            .then(setDetail)
                            .catch((e) => setError(String(e)))
                        }
                      >
                        {L("Details", "تفاصيل")}
                      </button>
                      {p.allowed("inventory", "edit") &&
                        r.status === "draft" && (
                          <button
                            className="text-blue-700"
                            onClick={() =>
                              void action(
                                paths.purchases + "/" + r.id + "/action",
                                { action: "order" },
                              )
                            }
                          >
                            {L("Mark ordered", "تسجيل الطلب")}
                          </button>
                        )}
                      {p.allowed("inventory", "edit") &&
                        r.status === "ordered" && (
                          <button
                            className="text-blue-700"
                            onClick={() =>
                              void action(
                                paths.purchases + "/" + r.id + "/action",
                                { action: "receive" },
                              )
                            }
                          >
                            {L("Receive stock", "استلام المخزون")}
                          </button>
                        )}
                    </>
                  )}
                  {tab === "transfers" &&
                    r.status === "pending" &&
                    p.allowed("inventory", "approve") && (
                      <>
                        <button
                          className="text-blue-700"
                          onClick={() =>
                            void action(
                              paths.transfers + "/" + r.id + "/decision",
                              { decision: "approved" },
                            )
                          }
                        >
                          {L("Approve", "موافقة")}
                        </button>
                        <button
                          className="text-red-700"
                          onClick={() =>
                            void action(
                              paths.transfers + "/" + r.id + "/decision",
                              { decision: "rejected" },
                            )
                          }
                        >
                          {L("Reject", "رفض")}
                        </button>
                      </>
                    )}
                  {tab === "sales" &&
                    r.status === "dispatched" &&
                    p.allowed("inventory", "edit") && (
                      <button
                        className="text-blue-700"
                        onClick={() =>
                          void action(paths.sales + "/" + r.id + "/return")
                        }
                      >
                        {L("Return physical goods", "إرجاع البضاعة فقط")}
                      </button>
                    )}
                  {tab === "loans" &&
                    !r.returned_on &&
                    p.allowed("library", "edit") && (
                      <Form
                        title={L("Return copy", "إرجاع النسخة")}
                        ar={ar}
                        fields={[
                          f(
                            "returned_on",
                            "Return date",
                            "تاريخ الإرجاع",
                            "date",
                          ),
                        ]}
                        options={{}}
                        initial={{
                          returned_on: new Date().toISOString().slice(0, 10),
                        }}
                        submit={async (d) => {
                          await p.api(
                            paths.loans + "/" + r.id + "/return",
                            "POST",
                            d,
                          );
                          await load();
                        }}
                      />
                    )}
                  {tab === "reservations" &&
                    r.status === "waiting" &&
                    p.allowed("library", "edit") && (
                      <button
                        className="text-red-700"
                        onClick={() =>
                          void action(
                            paths.reservations + "/" + r.id + "/cancel",
                          )
                        }
                      >
                        {L("Cancel", "إلغاء")}
                      </button>
                    )}
                  {tab === "assets" && (
                    <button
                      className="text-blue-700"
                      onClick={() =>
                        void p
                          .api(paths.assets + "/" + r.id)
                          .then(setDetail)
                          .catch((e) => setError(String(e)))
                      }
                    >
                      {L("History / assign", "السجل / التخصيص")}
                    </button>
                  )}
                </div>,
              ])}
            />
            {!rows.length && (
              <p className="p-6 text-sm text-slate-500">
                {L("No saved records yet.", "مفيش سجلات محفوظة لسه.")}
              </p>
            )}
          </Card>
          <p className="text-xs leading-7 text-slate-500">
            {L(
              "Purchase orders and stock dispatch are operational records. No order is sent to a supplier and no money moves. Returns do not automatically refund invoices. Valuation uses the catalog standard cost, not FIFO. Library penalties are recorded, not collected.",
              "أوامر الشراء وتسليم المخزون سجلات تشغيلية فقط. لا يتم إرسال طلب للمورد أو تحريك أموال. المرتجعات لا تسترد الفاتورة تلقائيا. التقييم بالتكلفة المعيارية وليس FIFO. غرامات المكتبة مسجلة وليست محصلة.",
            )}
          </p>
        </>
      )}
      {detail && (
        <Dialog
          title={detail.data.number || detail.data.name}
          close={() => setDetail(null)}
        >
          {detail.lines ? (
            <Table
              heads={[
                L("Item", "الصنف"),
                L("Quantity", "الكمية"),
                L("Unit cost", "تكلفة الوحدة"),
              ]}
              rows={detail.lines.map((r: Row) => [
                r.item_name,
                r.quantity,
                money(r.unit_cost),
              ])}
            />
          ) : (
            <>
              <Table
                heads={[
                  L("Event", "الحدث"),
                  L("Notes", "ملاحظات"),
                  L("Cost record", "التكلفة المسجلة"),
                ]}
                rows={detail.events.map((r: Row) => [
                  r.kind,
                  r.notes,
                  money(r.cost),
                ])}
              />
              {detail.transfers?.map((tr: Row) => (
                <div
                  key={tr.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"
                >
                  <span>
                    {tr.destination} · <Badge value={tr.status} ar={ar} />
                  </span>
                  {tr.status === "pending" &&
                    p.allowed("inventory", "edit") && (
                      <div className="flex gap-2">
                        {["approved", "rejected"].map((decision) => (
                          <Button
                            key={decision}
                            onClick={() =>
                              void action(
                                paths.assets +
                                  "/" +
                                  detail.data.id +
                                  "/transfer/" +
                                  tr.id +
                                  "/decision",
                                { decision },
                              ).then(() => setDetail(null))
                            }
                          >
                            {decision === "approved"
                              ? L("Approve transfer", "اعتماد النقل")
                              : L("Reject transfer", "رفض النقل")}
                          </Button>
                        ))}
                      </div>
                    )}
                </div>
              ))}
              {p.allowed("inventory", "edit") &&
                detail.data.status === "available" && (
                  <Form
                    title={L("Request branch transfer", "طلب نقل لفرع")}
                    ar={ar}
                    options={options}
                    fields={[
                      f(
                        "to_branch",
                        "Destination branch",
                        "الفرع المستلم",
                        "select",
                        "branches",
                      ),
                      f("notes", "Transfer reason", "سبب النقل"),
                    ]}
                    submit={async (d) => {
                      await p.api(
                        paths.assets + "/" + detail.data.id + "/transfer",
                        "POST",
                        d,
                      );
                      setDetail(null);
                      await load();
                    }}
                  />
                )}
              {p.allowed("inventory", "edit") && (
                <Form
                  title={L("Record asset event", "تسجيل حركة أصل")}
                  ar={ar}
                  options={options}
                  fields={[
                    f("status", "Status", "الحالة", "select", undefined, [
                      "available",
                      "assigned",
                      "maintenance",
                      "retired",
                    ]),
                    {
                      ...f(
                        "employee_id",
                        "Assigned employee",
                        "الموظف المسؤول",
                        "select",
                        "employees",
                      ),
                      optional: true,
                    },
                    { ...f("location", "Location", "المكان"), optional: true },
                    f("notes", "Event notes", "ملاحظات الحركة"),
                    f(
                      "cost",
                      "Recorded maintenance cost",
                      "تكلفة الصيانة المسجلة",
                      "number",
                    ),
                  ]}
                  submit={async (d) => {
                    await p.api(
                      paths.assets + "/" + detail.data.id + "/event",
                      "POST",
                      d,
                    );
                    setDetail(null);
                    await load();
                  }}
                />
              )}
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
export function Documents(
  p: Props & {
    portal?: boolean;
    targetKind?: string;
    targetId?: string;
    branchId?: string;
    canUpload?: boolean;
  },
) {
  const ar = p.t.language === "English",
    L = (e: string, a: string) => (ar ? a : e),
    prefix = p.portal ? "/portal/documents" : "/documents";
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [detail, setDetail] = useState<Row | null>(null),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [targetKind, setTargetKind] = useState(p.targetKind ?? "student"),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [expiry, setExpiry] = useState("");
  async function load() {
    try {
      const q = p.targetKind
        ? "?target_kind=" + p.targetKind + "&target_id=" + p.targetId
        : "";
      const filters = new URLSearchParams(q);
      if (query) filters.set("q", query);
      if (expiry) filters.set("expires_before", expiry);
      setRows((await p.api(prefix + "?" + filters)).data);
      if (!p.portal && !p.targetKind) {
        const o: Record<string, Row[]> = {
          branches: (await p.api("/resource-options")).branches,
        };
        for (const [k, path] of [
          ["branches", "/branches"],
          ["student", "/students"],
          ["teacher", "/teachers"],
          ["employee", "/operations/employees"],
          ["group", "/groups"],
          ["ticket", "/support"],
          ["finance", "/invoices"],
        ]) {
          const resource =
            k === "employee"
              ? "hr"
              : k === "ticket"
                ? "support"
                : k === "finance"
                  ? "finance"
                  : k === "group"
                    ? "groups"
                    : k + "s";
          if (k === "branches") continue;
          if (p.allowed(resource)) o[k] = (await p.api(path)).data;
        }
        setOptions(o);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, [p.targetId]);
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget),
        file = fd.get("file") as File;
      if (!file || file.size < 1 || file.size > 131072)
        throw Error(
          L(
            "Choose a PDF, PNG or JPEG up to 128 KiB.",
            "اختر PDF أو PNG أو JPEG بحد أقصى 128 KiB.",
          ),
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const body = { filename: file.name, mime: file.type, data: btoa(binary) };
      if (detail)
        await p.api(prefix + "/" + detail.data.id + "/versions", "POST", body);
      else
        await p.api(prefix, "POST", {
          ...body,
          branch_id: p.branchId || fd.get("branch_id"),
          target_kind: p.targetKind || targetKind,
          target_id: p.targetId || fd.get("target_id"),
          title: fd.get("title"),
          category: fd.get("category"),
          shared_portal: fd.get("shared_portal") === "on",
          expires_on: fd.get("expires_on") || "",
        });
      setOpen(false);
      setDetail(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">
            {L("Private document store", "مخزن المستندات الخاص")}
          </h2>
          <p className="mt-2 text-xs leading-7 text-slate-500">
            {L(
              "Encrypted PDF / PNG / JPEG. 128 KiB per version, 20 versions per document. Downloads require permission.",
              "PDF / PNG / JPEG مشفرة. 128 KiB لكل نسخة، و20 نسخة للمستند. التنزيل حسب الصلاحية.",
            )}
          </p>
        </div>
        {(!p.portal ||
          p.targetKind === "ticket" ||
          (p.targetKind === "group" && p.canUpload)) && (
          <Button
            onClick={() => {
              setDetail(null);
              setOpen(true);
            }}
          >
            {L("Upload document", "رفع مستند")}
          </Button>
        )}
      </div>
      {rows.some(
        (r) =>
          r.status === "active" &&
          r.expires_on &&
          r.expires_on <=
            new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      ) && (
        <p
          role="status"
          className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800"
        >
          {L(
            "Some listed documents are expired or expire within 30 days. Review their expiration dates below.",
            "بعض المستندات المعروضة انتهت أو هتنتهي خلال 30 يوم. راجع تواريخ الانتهاء أدناه.",
          )}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <Field label={L("Search title or category", "بحث بالعنوان أو التصنيف")}>
          <Input
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field label={L("Expires on or before", "تنتهي في أو قبل")}>
          <Input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </Field>
        <Button type="submit">{L("Filter", "تصفية")}</Button>
      </form>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <Card>
        <Table
          heads={[
            L("Title", "العنوان"),
            L("Category", "التصنيف"),
            L("Target", "الملف"),
            L("Expires", "الانتهاء"),
            L("Version", "النسخة"),
            L("Action", "الإجراء"),
          ]}
          rows={rows.map((r) => [
            r.title,
            r.category,
            r.target_kind,
            r.expires_on || "—",
            r.version,
            <button
              className="text-blue-700"
              onClick={() =>
                void p
                  .api(prefix + "/" + r.id)
                  .then(setDetail)
                  .catch((e) => setError(String(e)))
              }
            >
              {L("Versions / download", "النسخ / التنزيل")}
            </button>,
          ])}
        />
        {!rows.length && (
          <p className="p-5 text-sm text-slate-500">
            {L("No matching documents.", "مفيش مستندات مطابقة.")}
          </p>
        )}
      </Card>
      {detail && !open && (
        <Dialog title={detail.data.title} close={() => setDetail(null)}>
          <Table
            heads={[
              L("Version", "النسخة"),
              L("File", "الملف"),
              L("Bytes", "الحجم"),
              L("Download", "تنزيل"),
            ]}
            rows={detail.versions.map((v: Row) => [
              v.version,
              v.filename,
              v.byte_size,
              <a
                href={
                  "/api" +
                  prefix +
                  "/" +
                  detail.data.id +
                  "/download/" +
                  v.version
                }
                className="text-blue-700"
                download
              >
                {L("Download", "تنزيل")}
              </a>,
            ])}
          />
          {detail.can_version && (
            <Button className="mt-5" onClick={() => setOpen(true)}>
              {L("Upload new version", "رفع نسخة جديدة")}
            </Button>
          )}
          {!p.portal && p.allowed("documents", "edit") && (
            <div className="mt-4">
              <Form
                title={L("Edit sharing / archive", "تعديل المشاركة / الأرشفة")}
                ar={ar}
                options={{}}
                initial={{
                  ...detail.data,
                  shared_portal: detail.data.shared_portal ? "yes" : "no",
                }}
                fields={[
                  f("title", "Title", "العنوان"),
                  f("category", "Category", "التصنيف"),
                  f(
                    "shared_portal",
                    "Share with linked portal",
                    "المشاركة مع البوابة المرتبطة",
                    "select",
                    undefined,
                    ["yes", "no"],
                  ),
                  {
                    ...f("expires_on", "Expires on", "تاريخ الانتهاء", "date"),
                    optional: true,
                  },
                  f("status", "Status", "الحالة", "select", undefined, [
                    "active",
                    "archived",
                  ]),
                ]}
                submit={async (d) => {
                  await p.api("/documents/" + detail.data.id, "PUT", {
                    ...d,
                    shared_portal: d.shared_portal === "yes",
                  });
                  setDetail(null);
                  await load();
                }}
              />
            </div>
          )}
        </Dialog>
      )}
      {open && (
        <Dialog
          title={
            detail
              ? L("New document version", "نسخة جديدة")
              : L("Upload document", "رفع مستند")
          }
          close={() => setOpen(false)}
        >
          <form className="grid gap-4" onSubmit={upload}>
            {!detail && (
              <>
                {!p.portal && !p.targetKind && (
                  <>
                    <Field label={L("Branch", "الفرع")}>
                      <Select
                        aria-label={L("Branch", "الفرع")}
                        name="branch_id"
                        required
                      >
                        {options.branches?.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={L("Target type", "نوع الملف")}>
                      <Select
                        value={targetKind}
                        onChange={(e) => setTargetKind(e.target.value)}
                      >
                        {[
                          "student",
                          "teacher",
                          "employee",
                          "group",
                          "ticket",
                          "finance",
                        ].map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={L("Target record", "السجل المرتبط")}>
                      <Select
                        aria-label={L("Target record", "السجل المرتبط")}
                        name="target_id"
                        required
                      >
                        {options[targetKind]?.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name || r.subject || r.number}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </>
                )}
                <Field label={L("Title", "العنوان")}>
                  <Input required name="title" />
                </Field>
                <Field label={L("Category", "التصنيف")}>
                  <Input required name="category" />
                </Field>
                <Field label={L("Expiry (optional)", "الانتهاء (اختياري)")}>
                  <Input type="date" name="expires_on" />
                </Field>
                <label className="flex gap-3 text-sm">
                  <input type="checkbox" name="shared_portal" />
                  {L(
                    "Share with the linked student, family or class portal",
                    "المشاركة مع بوابة الطالب أو الأسرة أو المجموعة المرتبطة",
                  )}
                </label>
              </>
            )}
            <Field label={L("File", "الملف")}>
              <Input
                required
                type="file"
                name="file"
                accept="application/pdf,image/png,image/jpeg"
              />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {L("Encrypt & save", "تشفير وحفظ")}
            </Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
export function Support(
  p: Props & { portal?: boolean; studentId?: string; branchId?: string },
) {
  const ar = p.t.language === "English",
    L = (e: string, a: string) => (ar ? a : e),
    prefix = p.portal ? "/portal/support" : "/support";
  const [rows, setRows] = useState<Row[]>([]),
    [detail, setDetail] = useState<Row | null>(null),
    [options, setOptions] = useState<Record<string, Row[]>>({}),
    [error, setError] = useState("");
  async function load() {
    try {
      setRows((await p.api(prefix)).data);
      if (!p.portal) setOptions(await p.api("/support-options"));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function refresh(id: string) {
    setDetail(await p.api(prefix + "/" + id));
    await load();
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">
          {L("Support & complaints", "الدعم والشكاوى")}
        </h2>
        <Form
          title={L("New support ticket", "تذكرة دعم جديدة")}
          ar={ar}
          options={options}
          fields={[
            ...(!p.portal ? [branch] : []),
            f("category", "Category", "التصنيف", "select", undefined, [
              "academic",
              "financial",
              "registration",
              "teacher_complaint",
              "technical",
              "general",
            ]),
            f("priority", "Priority", "الأولوية", "select", undefined, [
              "low",
              "normal",
              "high",
              "urgent",
            ]),
            f("subject", "Subject", "الموضوع"),
            f("body", "Describe the issue", "وصف المشكلة"),
          ]}
          initial={{ priority: "normal", category: "general" }}
          submit={async (d) => {
            await p.api(prefix, "POST", {
              ...d,
              ...(p.studentId ? { student_id: p.studentId } : {}),
            });
            await load();
          }}
        />
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <Card>
        <Table
          heads={[
            L("Ticket", "التذكرة"),
            L("Subject", "الموضوع"),
            L("Priority", "الأولوية"),
            L("Status", "الحالة"),
            L("Action", "الإجراء"),
          ]}
          rows={rows.map((r) => [
            r.number,
            r.subject,
            <Badge value={r.priority} ar={ar} />,
            <Badge value={r.status} ar={ar} />,
            <button
              className="text-blue-700"
              onClick={() =>
                void refresh(r.id).catch((e) => setError(String(e)))
              }
            >
              {L("Open", "فتح")}
            </button>,
          ])}
        />
        {!rows.length && (
          <p className="p-5 text-sm text-slate-500">
            {L("No support tickets yet.", "مفيش تذاكر دعم لسه.")}
          </p>
        )}
      </Card>
      {detail && (
        <Dialog
          title={detail.data.number + " · " + detail.data.subject}
          close={() => setDetail(null)}
        >
          <p className="mb-5 whitespace-pre-wrap text-sm leading-8">
            {detail.data.body}
          </p>
          {detail.messages.map((m: Row) => (
            <div
              key={m.id}
              className={
                "my-3 rounded-xl p-4 " +
                (m.internal
                  ? "bg-amber-50 text-amber-950"
                  : "bg-slate-50 dark:bg-slate-950")
              }
            >
              <strong className="text-xs">
                {m.author}
                {m.internal
                  ? " · " + L("Internal staff note", "ملاحظة داخلية")
                  : ""}
              </strong>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
                {m.body}
              </p>
            </div>
          ))}
          <div className="my-5 flex flex-wrap gap-3">
            {!["resolved", "closed"].includes(detail.data.status) && (
              <Form
                title={L("Add reply", "إضافة رد")}
                ar={ar}
                options={{}}
                fields={[
                  f("body", "Reply", "الرد"),
                  ...(detail.staff
                    ? [
                        f(
                          "internal",
                          "Internal staff note?",
                          "ملاحظة داخلية؟",
                          "select",
                          undefined,
                          ["no", "yes"],
                        ),
                      ]
                    : []),
                ]}
                initial={{ internal: "no" }}
                submit={async (d) => {
                  await p.api(
                    prefix + "/" + detail.data.id + "/messages",
                    "POST",
                    { ...d, internal: d.internal === "yes" },
                  );
                  await refresh(detail.data.id);
                }}
              />
            )}
            {detail.staff && (
              <Form
                title={L("Assign / update status", "تخصيص / تحديث الحالة")}
                ar={ar}
                options={options}
                fields={[
                  f("status", "Status", "الحالة", "select", undefined, [
                    "open",
                    "in_progress",
                    "waiting",
                    "resolved",
                    "closed",
                  ]),
                  f("priority", "Priority", "الأولوية", "select", undefined, [
                    "low",
                    "normal",
                    "high",
                    "urgent",
                  ]),
                  {
                    ...f(
                      "assigned_to",
                      "Assigned support user",
                      "مسؤول الدعم",
                      "select",
                      "users",
                    ),
                    optional: true,
                  },
                ]}
                initial={detail.data}
                submit={async (d) => {
                  await p.api(
                    "/support/" + detail.data.id + "/manage",
                    "POST",
                    d,
                  );
                  await refresh(detail.data.id);
                }}
              />
            )}
            {p.portal &&
              ["resolved", "closed"].includes(detail.data.status) &&
              !detail.data.rating && (
                <Form
                  title={L("Rate support", "تقييم الدعم")}
                  ar={ar}
                  options={{}}
                  fields={[
                    f("rating", "Rating 1–5", "التقييم من 1 إلى 5", "number"),
                    { ...f("note", "Feedback", "ملاحظات"), optional: true },
                  ]}
                  initial={{ rating: 5 }}
                  submit={async (d) => {
                    await p.api(
                      prefix + "/" + detail.data.id + "/rating",
                      "POST",
                      d,
                    );
                    await refresh(detail.data.id);
                  }}
                />
              )}
          </div>
          <Documents
            {...p}
            portal={p.portal}
            targetKind="ticket"
            targetId={detail.data.id}
            branchId={detail.data.branch_id}
          />
        </Dialog>
      )}
    </div>
  );
}
export function Reports(p: Props) {
  const ar = p.t.language === "English",
    L = (e: string, a: string) => (ar ? a : e);
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [section, setSection] = useState("academic"),
    [options, setOptions] = useState<Record<string, Row[]>>({});
  const requestRevision = useRef(0);
  useEffect(() => {
    p.api("/reports/options")
      .then(setOptions)
      .catch((e) => setError(String(e)));
  }, []);
  const labels: Record<string, string> = {
    branch_name: L("Branch", "الفرع"),
    course_name: L("Course", "الكورس"),
    teacher_name: L("Teacher", "المدرس"),
    group_name: L("Group", "المجموعة"),
    name: L("Name", "الاسم"),
    capacity: L("Capacity", "السعة"),
    active_students: L("Active students", "الطلاب النشطون"),
    departed_students: L("Departed students", "الطلاب المنسحبون"),
    sessions: L("Sessions", "الحصص"),
    average_score: L("Average score %", "متوسط الدرجات %"),
    published_lessons: L("Published lessons", "الدروس المنشورة"),
    completed_checks: L("Completion checks", "إكمال الدروس"),
    records: L("Records", "السجلات"),
    attended: L("Attended", "حاضر"),
    absent: L("Absent", "غائب"),
    attendance_percent: L("Attendance %", "الحضور %"),
    minutes: L("Minutes", "الدقائق"),
    booked_minutes: L("Booked minutes", "الدقائق المحجوزة"),
    classroom_name: L("Room", "القاعة"),
    students: L("Students", "الطلاب"),
    leads: L("Leads", "العملاء المحتملون"),
    converted: L("Converted", "تم تحويلهم"),
    collected: L("Collected", "المحصل"),
    expenses: L("Expenses", "المصروفات"),
    refunded: L("Refunded", "المسترد"),
    total: L("Total", "الإجمالي"),
    status: L("Status", "الحالة"),
    month: L("Month", "الشهر"),
  };
  const label = (k: string) => labels[k] ?? k.replaceAll("_", " ");
  async function excel() {
    try {
      const rows: Row[] = data?.[section] ?? [],
        keys = rows.length
          ? Object.keys(rows[0]).filter((k) => k !== "id")
          : [];
      const { default: write } = await import("write-excel-file/browser");
      await write(
        [
          keys.map((k) => ({
            value: label(k),
            fontWeight: "bold",
            backgroundColor: "#EAF0FC",
            wrap: true,
          })),
          ...rows.map((r) =>
            keys.map((k) => ({
              value: typeof r[k] === "number" ? r[k] : String(r[k] ?? ""),
              type: typeof r[k] === "number" ? Number : String,
            })),
          ),
        ],
        {
          sheet: "ELCenter",
          columns: keys.map((k) => ({
            width: k.includes("name") || k === "name" ? 28 : 20,
          })),
        },
      ).toFile("elcenter-" + section + ".xlsx");
    } catch (e) {
      setError(String(e));
    }
  }
  async function load(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setData(null);
    setError("");
    const ticket = ++requestRevision.current;
    try {
      const fd = new FormData(e.currentTarget),
        q = new URLSearchParams();
      for (const [k, v] of fd.entries()) if (v) q.set(k, String(v));
      const result = await p.api("/reports/overview?" + q);
      if (ticket === requestRevision.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (ticket === requestRevision.current) setError(String(e));
    }
  }
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">
        {L("Cross-center reports", "تقارير المركز")}
      </h2>
      <p className="text-xs leading-6 text-slate-500">
        {L(
          "Complete-or-reject: up to 300 rows per academic, attendance, workload or room section; 100 per branch, finance or payroll section. Larger results need narrower applicable filters. No partial report is exported.",
          "تقرير كامل أو رفض: لحد 300 صف لكل قسم أكاديمي أو حضور أو عبء تدريس أو قاعات، و100 لكل قسم فروع أو حسابات أو مرتبات. لو أكبر، ضيّق الفلاتر المناسبة. مفيش تصدير لتقرير جزئي.",
        )}
      </p>
      <Card className="p-5">
        <form onSubmit={load} className="flex flex-wrap items-end gap-4">
          <Field label={L("From", "من")}>
            <Input
              required
              name="from"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 7) + "-01"}
            />
          </Field>
          <Field label={L("To", "إلى")}>
            <Input
              required
              name="to"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          {[
            ["branch_id", "branches", L("Branch", "الفرع")],
            ["course_id", "courses", L("Course", "الكورس")],
            ["teacher_id", "teachers", L("Teacher", "المدرس")],
          ].map(([name, key, title]) => (
            <Field key={name} label={title}>
              <Select name={name} aria-label={title}>
                <option value="">
                  {L("All in my scope", "الكل في نطاق صلاحياتي")}
                </option>
                {options[key]?.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          <Button type="submit">{L("Run report", "عرض التقرير")}</Button>
        </form>
      </Card>
      <ReportSchedules
        api={p.api}
        ar={ar}
        canCreate={p.allowed("reports", "create")}
        canEdit={p.allowed("reports", "edit")}
      />
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {data && (
        <>
          <nav className="flex flex-wrap gap-2">
            {[
              "academic",
              "attendance",
              "workload",
              "rooms",
              "branches",
              "finance",
              "payroll",
            ].map((k) => (
              <button
                key={k}
                onClick={() => setSection(k)}
                className={
                  "rounded-xl px-3 py-2 text-sm " +
                  (section === k
                    ? "bg-blue-700 text-white"
                    : "bg-white text-slate-500 dark:bg-slate-900")
                }
              >
                {
                  (
                    {
                      academic: L("Groups & learning", "المجموعات والتعلم"),
                      attendance: L("Attendance", "الحضور"),
                      workload: L("Teacher workload", "عبء المدرسين"),
                      rooms: L("Rooms", "القاعات"),
                      branches: L("Branches & admissions", "الفروع والتسجيل"),
                      finance: L(
                        "Collections & expenses",
                        "التحصيل والمصروفات",
                      ),
                      payroll: L("Payroll", "المرتبات"),
                    } as Row
                  )[k]
                }
              </button>
            ))}
          </nav>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void excel()}>
              {L("Export Excel", "تصدير Excel")}
            </Button>
            <Button
              onClick={() =>
                printRecord(
                  L("Center report", "تقرير المركز"),
                  document.getElementById("resource-report")!,
                  true,
                )
              }
            >
              {L("Print / Save PDF", "طباعة / حفظ PDF")}
            </Button>
            <Button
              onClick={() => {
                const rows = data[section] ?? [],
                  keys = rows.length
                    ? Object.keys(rows[0]).filter((k) => k !== "id")
                    : [];
                const cell = (v: unknown) =>
                  '"' +
                  String(v ?? "")
                    .replace(/^[=+@-]/, "'$&")
                    .replaceAll('"', '""') +
                  '"';
                const csv =
                  "\uFEFF" +
                  [
                    keys.map(label),
                    ...rows.map((r: Row) => keys.map((k) => r[k])),
                  ]
                    .map((row) => row.map(cell).join(","))
                    .join("\n");
                const url = URL.createObjectURL(
                    new Blob([csv], { type: "text/csv;charset=utf-8" }),
                  ),
                  a = document.createElement("a");
                a.href = url;
                a.download = "elcenter-" + section + ".csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              {L("Export spreadsheet CSV", "تصدير CSV للجداول")}
            </Button>
          </div>
          <Card className="overflow-hidden">
            <div id="resource-report">
              <h3 className="p-5 font-semibold">
                ELCenter · {data.filters.from} / {data.filters.to}
              </h3>
              {data[section]?.length ? (
                <Table
                  heads={Object.keys(data[section][0])
                    .filter((k) => k !== "id")
                    .map(label)}
                  rows={data[section].map((r: Row) =>
                    Object.entries(r)
                      .filter(([k]) => k !== "id")
                      .map(([, v]) => (
                        <span className="inline-block min-w-24">
                          {String(v ?? "—")}
                        </span>
                      )),
                  )}
                />
              ) : (
                <p className="p-5 text-sm text-slate-500">
                  {L(
                    "No report rows in this range or permission scope.",
                    "مفيش نتائج في الفترة أو الصلاحيات دي.",
                  )}
                </p>
              )}
            </div>
          </Card>
          <p className="text-xs leading-7 text-slate-500">
            {L(
              "Figures are operational records. Current active/withdrawn counts are not cohort retention. Room output is booked minutes, not utilization percent. Completion checks are not certificates. Use accounting reports for historical financial balances.",
              "الأرقام سجلات تشغيلية. أعداد النشطين والمنسحبين ليست معدل احتفاظ تاريخي. القاعات تعرض الدقائق المحجوزة وليس نسبة الاستغلال. إكمال الدروس ليس شهادة. استخدم تقارير الحسابات للأرصدة المالية التاريخية.",
            )}
          </p>
        </>
      )}
    </div>
  );
}
