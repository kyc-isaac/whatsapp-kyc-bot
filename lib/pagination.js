function pagination(query = {}) {
  const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw Object.assign(new Error('Paginación inválida'), { status: 400 });
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}
module.exports = { pagination };
